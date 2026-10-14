#include <cassert>
#include "cf/analytics_sql.hpp"
#include "cf/task.hpp"
static void u32(cf::Bytes& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
static void u64(cf::Bytes& bytes, std::uint64_t value) { u32(bytes, static_cast<std::uint32_t>(value)); u32(bytes, static_cast<std::uint32_t>(value >> 32)); }
static void text(cf::Bytes& bytes, const std::string& value) { u32(bytes, static_cast<std::uint32_t>(value.size())); bytes.insert(bytes.end(), value.begin(), value.end()); }
static cf::Bytes packet(std::vector<cf::AnalyticsSqlRow> rows = {{{"value", true}}}, double elapsed = 0.25) {
  cf::Bytes bytes; u32(bytes, static_cast<std::uint32_t>(rows.size())); u64(bytes, std::bit_cast<std::uint64_t>(elapsed)); u64(bytes, 10); u64(bytes, 100);
  for (const auto& row : rows) {
    u32(bytes, static_cast<std::uint32_t>(row.size()));
    for (const auto& column : row) {
      text(bytes, column.name);
      if (std::holds_alternative<std::nullptr_t>(column.value)) u32(bytes, 0);
      else if (const auto* b = std::get_if<bool>(&column.value)) u32(bytes, *b ? 2 : 1);
      else if (const auto* n = std::get_if<double>(&column.value)) { u32(bytes, 3); u64(bytes, std::bit_cast<std::uint64_t>(*n)); }
      else { u32(bytes, 4); text(bytes, std::get<std::string>(column.value)); }
    }
  }
  return bytes;
}
int main() {
  using namespace cf;
  OperationReply reply{ReplyKind::Value, packet()}; OperationCall observed{}; int calls = 0; bool fail = false;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    if (fail) done(Result<OperationReply>::failure({ErrorCode::HostFailure, "query failed"}));
    else done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  AnalyticsSql sql(runtime, "ANALYTICS");
  auto handler = [&]() -> Task {
    AnalyticsSqlQuery command{"SELECT value FROM synthetic WHERE timestamp >= $start LIMIT 1", {}};
    auto value = co_await sql.query(command); assert(value && std::get<bool>(value.value().rows[0][0].value));
    assert(value.value().statistics.elapsed.count() == 0.25 && value.value().statistics.rows_read == 10 && value.value().statistics.bytes_read == 100);
    assert(observed.method == Operation::AnalyticsSqlQuery && observed.binding == "ANALYTICS" && observed.key == command.statement && observed.body.empty() && observed.options == "100:5000");
    command.parameters = AnalyticsSqlNamedParameters{{"__proto__", std::string("owned")}, {"start", nullptr}};
    AnalyticsSqlOptions options{1, std::chrono::milliseconds(60000)};
    const auto original = command.statement; auto pending = sql.query(command, options);
    command.statement = "changed"; command.parameters.reset(); options.row_limit = 0; options.timeout = std::chrono::milliseconds(0);
    assert(co_await pending); assert(observed.key == original && observed.options == "1:60000");
    assert(std::string(observed.body.begin(), observed.body.end()) == "{\"__proto__\":\"owned\",\"start\":null}");
    command.parameters = AnalyticsSqlPositionalParameters{nullptr, false, true, -0.0, 0.25, std::string("\"\\\0", 3)};
    assert(co_await sql.query(command));
    assert(std::string(observed.body.begin(), observed.body.end()) == "[null,false,true,-0,0.25,\"\\\"\\\\\\u0000\"]");
    command.parameters = AnalyticsSqlPositionalParameters{}; assert(co_await sql.query(command)); assert(observed.body == Bytes({'[', ']'}));
    command.parameters = AnalyticsSqlNamedParameters{}; assert(co_await sql.query(command)); assert(observed.body == Bytes({'{', '}'}));
    AnalyticsSqlPositionalParameters maximum_params(16, std::string(4096, 'x')); maximum_params.back() = std::string(4047, 'x');
    command.parameters = maximum_params; assert(co_await sql.query(command)); assert(observed.body.size() == 65536);
    const int baseline = calls;
    maximum_params.back() = std::string(4048, 'x'); command.parameters = maximum_params; assert(!(co_await sql.query(command)));
    for (const auto& scalar : AnalyticsSqlPositionalParameters{std::string(1048576, 'x'), std::string("\xff"), std::numeric_limits<double>::infinity(), 9007199254740992.0}) {
      command.parameters = AnalyticsSqlPositionalParameters{scalar}; auto bad = co_await sql.query(command); assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    command.parameters = AnalyticsSqlPositionalParameters(101, nullptr); assert(!(co_await sql.query(command)));
    for (const auto& name : {"", "bad-name", "1name"}) { command.parameters = AnalyticsSqlNamedParameters{{name, nullptr}}; assert(!(co_await sql.query(command))); }
    command.parameters = AnalyticsSqlNamedParameters{{std::string(65, 'n'), nullptr}}; assert(!(co_await sql.query(command)));
    command.parameters.reset();
    for (const auto& statement : std::vector<std::string>{"", "\xff", std::string(10241, 'q'), std::string(1048576, 'q')}) {
      command.statement = statement; assert(!(co_await sql.query(command)));
    }
    command.statement = original;
    for (int timeout : {-1, 0, 60001}) assert(!(co_await sql.query(command, {100, std::chrono::milliseconds(timeout)})));
    for (unsigned limit : {0u, 101u}) assert(!(co_await sql.query(command, {limit})));
    assert(calls == baseline);
    const auto good = packet({{{"null", nullptr}, {"false", false}, {"true", true}, {"number", -0.0}, {"text", std::string("猫")}}});
    for (std::size_t n = 0; n < good.size(); ++n) { reply.bytes.assign(good.begin(), good.begin() + n); auto bad = co_await sql.query(command); assert(!bad && bad.error().code == ErrorCode::HostFailure); }
    std::vector<Bytes> invalid{packet({{{"", nullptr}}}), packet({{{std::string(129, 'n'), nullptr}}}), packet({{{"x", nullptr}, {"x", true}}}),
      packet({{{"x", std::string(4097, 'x')}}}), packet({{{"x", std::string("\xff")}}}), packet({{{"\xff", nullptr}}}),
      packet({{{"x", 9007199254740992.0}}}), packet({{{"x", std::numeric_limits<double>::quiet_NaN()}}}),
      packet({}, -1), packet({}, std::numeric_limits<double>::infinity()), packet({}, 9007199254740992.0), packet(std::vector<AnalyticsSqlRow>(101)), Bytes(1048577)};
    auto trailing = good; trailing.push_back(0); invalid.push_back(trailing);
    auto tag = packet({{{"x", nullptr}}}); tag[37] = 5; invalid.push_back(tag);
    auto columns = good; columns[28] = 65; invalid.push_back(columns);
    for (std::size_t offset : {12, 20}) { auto stats = good; for (std::size_t i = offset; i < offset + 8; ++i) stats[i] = 255; invalid.push_back(stats); }
    for (const auto& bytes : invalid) { reply.bytes = bytes; assert(!(co_await sql.query(command))); }
    reply = {ReplyKind::Missing, good}; assert(!(co_await sql.query(command)));
    reply = {ReplyKind::Value, packet({{}, {}})}; assert(!(co_await sql.query(command, {1})));
    reply.bytes = packet({}); assert(reply.bytes.size() == 28); assert((co_await sql.query(command)).value().rows.empty());
    const auto opaque = std::string("\xef\xbb\xbf猫") + '\0';
    reply.bytes = packet({{{"null", nullptr}, {"false", false}, {"true", true}, {"number", -0.0}, {"text", opaque}}, {}});
    auto owned = co_await sql.query(command); reply.bytes.clear(); assert(owned && owned.value().rows.size() == 2);
    assert(std::holds_alternative<std::nullptr_t>(owned.value().rows[0][0].value));
    assert(!std::get<bool>(owned.value().rows[0][1].value)); assert(std::signbit(std::get<double>(owned.value().rows[0][3].value)));
    assert(std::get<std::string>(owned.value().rows[0][4].value) == opaque);
    reply.bytes = packet(std::vector<AnalyticsSqlRow>(100)); assert((co_await sql.query(command)).value().rows.size() == 100);
    std::vector<AnalyticsSqlRow> maximum_rows(4);
    for (auto& row : maximum_rows) for (int i = 0; i < 64; ++i) row.push_back({"c" + std::string(i < 10 ? "0" : "") + std::to_string(i), std::string(4096, 'x')});
    maximum_rows.back().back().value = std::string(212, 'x'); reply.bytes = packet(maximum_rows); assert(reply.bytes.size() == 1048576);
    // MAX_SAFE_INTEGER fits u64 but larger integer statistics must still reject.
    for (std::size_t offset : {12, 20}) for (unsigned i = 0; i < 8; ++i) reply.bytes[offset + i] = static_cast<std::uint8_t>(9007199254740991ULL >> (8 * i));
    auto maximum = co_await sql.query(command); assert(maximum && maximum.value().statistics.rows_read == 9007199254740991ULL);
    maximum_rows.back().back().value = std::string(213, 'x'); reply.bytes = packet(maximum_rows); assert(!(co_await sql.query(command)));
    fail = true; auto failure = co_await sql.query(command); assert(!failure && failure.error().message == "query failed");
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
