#pragma once

#include <chrono>

#include "cf/env.hpp"
#include "cf/sql.hpp"

namespace cf {
enum class DurableEvent { Initialize, Fetch, Alarm };
inline Result<DurableEvent> durable_event(const Env& env) {
  const auto event = env.var("__LIBCF_DO_EVENT");
  if (event == "initialize") return Result<DurableEvent>::success(DurableEvent::Initialize);
  if (event == "fetch") return Result<DurableEvent>::success(DurableEvent::Fetch);
  if (event == "alarm") return Result<DurableEvent>::success(DurableEvent::Alarm);
  return Result<DurableEvent>::failure(
      {ErrorCode::InvalidInput, "not a Durable Object invocation"});
}

class DurableStorage {
 public:
  explicit DurableStorage(BindingRuntime runtime) : runtime_(std::move(runtime)) {}
  [[nodiscard]] AsyncResult<SqlResult> sql(SqlCommand command) const {
    auto bytes = detail::encode_sql_values(command.parameters);
    if (!bytes) return detail::failed_sql<SqlResult>(bytes.error());
    return runtime_.call<SqlResult>(
        {Operation::DurableSql, binding, std::move(command.sql), std::move(bytes.value()), {}},
        detail::decode_sql);
  }
  // One synchronous host transaction. Separate co_await sql() calls do NOT
  // promise an implicit transaction or prevent event interleaving.
  [[nodiscard]] AsyncResult<std::vector<SqlResult>> transaction(
      std::vector<SqlCommand> commands) const {
    auto bytes = detail::encode_sql_commands(commands);
    if (!bytes) return detail::failed_sql<std::vector<SqlResult>>(bytes.error());
    return runtime_.call<std::vector<SqlResult>>(
        {Operation::DurableSqlBatch, binding, {}, std::move(bytes.value()), {}},
        [expected = commands.size()](OperationReply reply) {
          return detail::decode_sql_batch(std::move(reply), expected);
        });
  }
  [[nodiscard]] AsyncResult<Unit> setAlarm(std::chrono::system_clock::time_point when) const {
    const auto milliseconds =
        std::chrono::duration_cast<std::chrono::milliseconds>(when.time_since_epoch()).count();
    if (milliseconds < 0 || milliseconds > 9007199254740991LL)
      return detail::failed_sql<Unit>(
          {ErrorCode::InvalidInput, "alarm time outside JavaScript precision"});
    return runtime_.call<Unit>(
        {Operation::DurableSetAlarm, binding, std::to_string(milliseconds), {}, {}},
        [](OperationReply) { return Result<Unit>::success({}); });
  }

 private:
  static constexpr const char* binding = "__LIBCF_DO_STORAGE";
  BindingRuntime runtime_;
};
}  // namespace cf
