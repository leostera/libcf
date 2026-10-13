#include <cassert>
#include <limits>
#include <string>

#include "libcf/d1.hpp"
#include "libcf/task.hpp"

int main() {
  using namespace libcf;
  assert(!detail::encode_sql_values({std::int64_t{9007199254740992LL}}));
  assert(!detail::encode_sql_values({std::numeric_limits<double>::infinity()}));
  auto parameters = detail::encode_sql_values({nullptr, 3.5, std::int64_t{42}, std::string("text"), Bytes{0, 255}});
  assert(parameters);
  detail::WireReader reader(parameters.value());
  std::uint32_t count = 0;
  assert(reader.u32(count) && count == 5);
  SqlValue value;
  assert(detail::read_sql_value(reader, value) && std::holds_alternative<std::nullptr_t>(value));
  assert(detail::read_sql_value(reader, value) && std::get<double>(value) == 3.5);
  assert(detail::read_sql_value(reader, value) && std::get<double>(value) == 42);
  assert(detail::read_sql_value(reader, value) && std::get<std::string>(value) == "text");
  assert(detail::read_sql_value(reader, value) && std::get<Bytes>(value) == (Bytes{0, 255}));
  assert(reader.done());

  Bytes encoded;
  detail::append_field(encoded, "{\"changes\":1}");
  detail::append_u32(encoded, 1);
  detail::append_u32(encoded, 1);
  detail::append_field(encoded, "name");
  detail::append_u32(encoded, 2);
  detail::append_field(encoded, "Ada");
  auto result = detail::decode_d1({ReplyKind::Value, encoded});
  assert(result && result.value().rows.size() == 1);
  assert(std::get<std::string>(result.value().rows[0].at("name")) == "Ada");
  encoded.push_back(0);
  assert(!detail::decode_d1({ReplyKind::Value, encoded}));
  assert(!detail::decode_d1({ReplyKind::Value, {1, 2, 3}}));

  bool host_called = false;
  BindingRuntime runtime([&](auto, auto) { host_called = true; }, [](auto) {});
  D1Database database(runtime, "DB");
  auto handler = [&]() -> Task {
    auto invalid = co_await database.prepare("SELECT ?").bind({std::int64_t{9007199254740992LL}}).all();
    assert(!invalid && invalid.error().code == ErrorCode::InvalidInput);
    co_return Response::text("rejected");
  };
  auto coroutine = handler().take();
  coroutine.resume();
  assert(coroutine.done() && !host_called);
  coroutine.destroy();
}
