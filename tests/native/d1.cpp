#include "cf/d1.hpp"

#include <cassert>
#include <limits>
#include <string>

#include "cf/durable_storage.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  assert(!detail::encode_sql_values({std::int64_t{9007199254740992LL}}));
  assert(!detail::encode_sql_values({std::numeric_limits<double>::infinity()}));
  auto parameters = detail::encode_sql_values(
      {nullptr, 3.5, std::int64_t{42}, std::string("text"), Bytes{0, 255}});
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
  auto result = detail::decode_sql({ReplyKind::Value, encoded});
  assert(result && result.value().rows.size() == 1);
  assert(std::get<std::string>(result.value().rows[0].at("name")) == "Ada");
  encoded.push_back(0);
  assert(!detail::decode_sql({ReplyKind::Value, encoded}));
  assert(!detail::decode_sql({ReplyKind::Value, {1, 2, 3}}));

  bool host_called = false;
  BindingRuntime runtime([&](auto, auto) { host_called = true; }, [](auto) {});
  D1Database database(runtime, "DB");
  const auto statement = database.prepare("SELECT ?").bind({std::int64_t{9007199254740992LL}});
  auto handler = [&]() -> Task {
    auto invalid = co_await statement.all();
    assert(!invalid && invalid.error().code == ErrorCode::InvalidInput);
    co_return Response::text("rejected");
  };
  auto coroutine = handler().take();
  coroutine.resume();
  assert(coroutine.done() && !host_called);
  coroutine.destroy();

  std::vector<D1Statement> wrong_binding;
  wrong_binding.push_back(D1Database(runtime, "OTHER").prepare("SELECT 1"));
  std::vector<D1Statement> unsafe_parameter;
  unsafe_parameter.push_back(statement);
  auto rejected_batch = [&]() -> Task {
    auto empty = co_await database.batch(std::vector<D1Statement>{});
    assert(!empty);
    auto foreign = co_await database.batch(wrong_binding);
    assert(!foreign);
    auto unsafe = co_await database.batch(unsafe_parameter);
    assert(!unsafe);
    co_return Response::text("batches rejected");
  };
  auto rejected = rejected_batch().take();
  rejected.resume();
  assert(rejected.done() && !host_called);
  rejected.destroy();

  BindingRuntime::Completion complete;
  OperationCall last;
  BindingRuntime batch_runtime(
      [&](auto call, auto done) {
        last = std::move(call);
        complete = std::move(done);
      },
      [](auto task) { task.resume(); });
  D1Database batch_database(batch_runtime, "DB");
  std::vector<D1Statement> valid_batch;
  valid_batch.push_back(batch_database.prepare("SELECT 1"));
  auto malformed_batch = [&]() -> Task {
    auto result = co_await batch_database.batch(valid_batch);
    assert(!result && result.error().code == ErrorCode::InvalidInput);
    co_return Response::text("malformed batch rejected");
  };
  auto malformed = malformed_batch().take();
  malformed.resume();
  assert(last.method == Operation::D1Batch && last.binding == "DB");
  auto deliver = std::move(complete);
  deliver(Result<OperationReply>::success({ReplyKind::Value, Bytes{0, 0, 0, 0}}));
  assert(malformed.done());
  malformed.destroy();

  DurableStorage storage(runtime);
  SqlCommand unsafe_command{"SELECT ?", {std::int64_t{9007199254740992LL}}};
  auto rejected_storage = [&]() -> Task {
    auto sql = co_await storage.sql(unsafe_command);
    assert(!sql && sql.error().code == ErrorCode::InvalidInput);
    auto alarm = co_await storage.setAlarm(
        std::chrono::system_clock::time_point{std::chrono::milliseconds{-1}});
    assert(!alarm && alarm.error().code == ErrorCode::InvalidInput);
    co_return Response::text("storage rejected");
  };
  auto invalid_storage = rejected_storage().take();
  invalid_storage.resume();
  assert(invalid_storage.done() && !host_called);
  invalid_storage.destroy();
  Env not_an_object([](std::string_view) -> std::optional<std::string> { return std::nullopt; });
  assert(!durable_event(not_an_object));
}
