#include <cassert>
#include "cf/flagship.hpp"
#include "cf/task.hpp"
static void u32(cf::Bytes& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
static cf::Bytes packet(bool value = false, std::optional<std::string> variant = "off",
    std::optional<std::string> reason = "STATIC", std::optional<std::string> code = {},
    std::optional<std::string> message = {}) {
  cf::Bytes bytes; u32(bytes, value ? 1 : 0);
  for (const auto& field : {variant, reason, code, message}) {
    u32(bytes, field ? 1 : 0);
    if (field) { u32(bytes, static_cast<std::uint32_t>(field->size())); bytes.insert(bytes.end(), field->begin(), field->end()); }
  }
  return bytes;
}
int main() {
  using namespace cf;
  OperationReply reply{ReplyKind::Value, packet()}; OperationCall observed{}; int calls = 0; bool fail = false;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    if (fail) done(Result<OperationReply>::failure({ErrorCode::HostFailure, "provider unavailable"}));
    else done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Flagship flags(runtime, "FLAGS");
  auto handler = [&]() -> Task {
    auto value = co_await flags.boolean_details("flag", true);
    assert(value && !value.value().value && value.value().variant == "off" && value.value().reason == "STATIC");
    assert(!value.value().error_code && !value.value().error_message);
    assert(observed.method == Operation::FlagshipBooleanDetails && observed.binding == "FLAGS");
    assert(observed.key == "flag" && observed.body.empty() && observed.options == "1:5000");
    std::string key(128, 'k'); FlagshipBooleanOptions options{std::string(256, 't'), std::chrono::milliseconds(60000)};
    auto pending = flags.boolean_details(key, false, options);
    key = "changed"; options.targeting_key = "changed"; options.timeout = std::chrono::milliseconds(0);
    assert(co_await pending);
    assert(observed.key == std::string(128, 'k') && observed.body == Bytes(256, 't') && observed.options == "0:60000");
    const int baseline = calls;
    for (const auto& invalid : std::vector<std::string>{"", std::string(129, 'k'), "\xff", "\xed\xa0\x80", std::string(1, '\0'), "\x1f", "\x7f", "\xc2\x80", "\xc2\x9f", std::string(1048576, 'x')}) {
      auto bad = co_await flags.boolean_details(invalid, false);
      assert(!bad && bad.error().code == ErrorCode::InvalidInput);
      FlagshipBooleanOptions bad_context{invalid};
      bad = co_await flags.boolean_details("flag", false, bad_context);
      // 129 bytes is a valid targeting key even though it exceeds the flag-key cap.
      if (invalid.size() == 129) assert(bad);
      else assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == baseline + 1);
    for (int timeout : {-1, 0, 60001}) {
      FlagshipBooleanOptions bad_options; bad_options.timeout = std::chrono::milliseconds(timeout);
      auto bad = co_await flags.boolean_details("flag", true, bad_options);
      assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    FlagshipBooleanOptions oversized{std::string(257, 't')};
    assert(!(co_await flags.boolean_details("flag", true, oversized)));
    assert(calls == baseline + 1);
    const auto good = packet(true, "", "ERROR", "FLAG_NOT_FOUND", "missing");
    for (std::size_t length = 0; length < good.size(); ++length) {
      reply.bytes.assign(good.begin(), good.begin() + length);
      auto bad = co_await flags.boolean_details("flag", false); assert(!bad && bad.error().code == ErrorCode::HostFailure);
    }
    std::vector<Bytes> invalid{packet(false, std::string(257, 'v')), packet(false, {}, std::string(65, 'r')),
      packet(false, {}, {}, std::string(65, 'c')), packet(false, {}, {}, {}, std::string(4097, 'm')),
      packet(false, "\xff"), packet(false, {}, "\xff"), packet(false, {}, {}, "\xff"), packet(false, {}, {}, {}, "\xff"), Bytes(4517)};
    auto trailing = good; trailing.push_back(0); invalid.push_back(trailing);
    auto boolean = good; boolean[0] = 2; invalid.push_back(boolean);
    const auto absent = packet(false, {}, {}, {}, {});
    for (std::size_t position : {4, 8, 12, 16}) { auto presence = absent; presence[position] = 2; invalid.push_back(presence); }
    for (const auto& bytes : invalid) {
      reply.bytes = bytes; auto bad = co_await flags.boolean_details("flag", true); assert(!bad && bad.error().code == ErrorCode::HostFailure);
    }
    reply = {ReplyKind::Missing, good}; assert(!(co_await flags.boolean_details("flag", true)));
    reply = {ReplyKind::Value, good}; auto fallback = co_await flags.boolean_details("flag", false);
    assert(fallback && fallback.value().value && fallback.value().variant && fallback.value().variant->empty());
    assert(fallback.value().reason == "ERROR" && fallback.value().error_code == "FLAG_NOT_FOUND");
    reply.bytes = absent; auto minimal = co_await flags.boolean_details("flag", true);
    assert(minimal && !minimal.value().value && !minimal.value().variant && !minimal.value().reason);
    reply.bytes = packet(true, std::string(256, 'v'), std::string(64, 'r'), std::string(64, 'c'), std::string(4096, 'm'));
    assert(reply.bytes.size() == 4516); auto maximum = co_await flags.boolean_details("flag", false);
    assert(maximum && maximum.value().error_message->size() == 4096);
    const auto opaque = std::string("\xef\xbb\xbf猫") + '\0' + "owned";
    reply.bytes = packet(true, "", "FUTURE", "", opaque);
    auto owned = co_await flags.boolean_details("猫", true, {"\xef\xbb\xbftarget"}); reply.bytes.clear();
    assert(owned && owned.value().error_message == opaque && owned.value().reason == "FUTURE");
    fail = true; auto failure = co_await flags.boolean_details("flag", true);
    assert(!failure && failure.error().message == "provider unavailable");
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
