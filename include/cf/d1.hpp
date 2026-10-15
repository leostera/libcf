#pragma once

#include <optional>

#include "cf/sql.hpp"

namespace cf {
class D1Statement {
 public:
  D1Statement(BindingRuntime runtime, std::string binding, std::string sql)
      : runtime_(std::move(runtime)), binding_(std::move(binding)), command_{std::move(sql), {}} {}
  [[nodiscard]] D1Statement bind(std::vector<SqlValue> values) const {
    D1Statement statement = *this;
    statement.command_.parameters = std::move(values);
    return statement;
  }
  [[nodiscard]] AsyncResult<SqlResult> all() const { return execute(Operation::D1All); }
  [[nodiscard]] AsyncResult<SqlResult> run() const { return execute(Operation::D1Run); }
  [[nodiscard]] AsyncResult<std::optional<SqlRow>> first() const {
    auto bytes = detail::encode_sql_values(command_.parameters);
    if (!bytes) return detail::failed_sql<std::optional<SqlRow>>(bytes.error());
    return runtime_.call<std::optional<SqlRow>>(
        {Operation::D1First, binding_, command_.sql, std::move(bytes.value()), {}},
        [](OperationReply reply) -> Result<std::optional<SqlRow>> {
          auto result = detail::decode_sql(std::move(reply));
          if (!result) return Result<std::optional<SqlRow>>::failure(result.error());
          auto& rows = result.value().rows;
          if (rows.empty()) return Result<std::optional<SqlRow>>::success(std::nullopt);
          if (rows.size() != 1)
            return Result<std::optional<SqlRow>>::failure(
                {ErrorCode::InvalidInput, "first returned multiple rows"});
          return Result<std::optional<SqlRow>>::success(std::move(rows.front()));
        });
  }

 private:
  friend class D1Database;
  AsyncResult<SqlResult> execute(Operation method) const {
    auto bytes = detail::encode_sql_values(command_.parameters);
    if (!bytes) return detail::failed_sql<SqlResult>(bytes.error());
    return runtime_.call<SqlResult>({method, binding_, command_.sql, std::move(bytes.value()), {}},
                                    detail::decode_sql);
  }
  BindingRuntime runtime_;
  std::string binding_;
  SqlCommand command_;
};

class D1Database {
 public:
  D1Database(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] D1Statement prepare(std::string sql) const {
    return D1Statement(runtime_, binding_, std::move(sql));
  }
  [[nodiscard]] AsyncResult<std::vector<SqlResult>> batch(
      std::vector<D1Statement> statements) const {
    std::vector<SqlCommand> commands;
    for (auto& statement : statements) {
      if (statement.binding_ != binding_)
        return detail::failed_sql<std::vector<SqlResult>>(
            {ErrorCode::InvalidInput, "batch statements must belong to the same D1 binding"});
      commands.push_back(std::move(statement.command_));
    }
    auto bytes = detail::encode_sql_commands(commands);
    if (!bytes) return detail::failed_sql<std::vector<SqlResult>>(bytes.error());
    return runtime_.call<std::vector<SqlResult>>(
        {Operation::D1Batch, binding_, {}, std::move(bytes.value()), {}},
        [expected = commands.size()](OperationReply reply) {
          return detail::decode_sql_batch(std::move(reply), expected);
        });
  }
  // Application-controlled setup only; use prepare().bind() for untrusted data.
  [[nodiscard]] AsyncResult<SqlResult> exec(std::string sql) const {
    return runtime_.call<SqlResult>({Operation::D1Exec, binding_, std::move(sql), {}, {}},
                                    detail::decode_sql);
  }

 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
