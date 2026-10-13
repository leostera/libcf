#pragma once

#include <bit>
#include <cmath>
#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "libcf/detail/wire.hpp"
#include "libcf/operation.hpp"

namespace libcf {

using SqlValue = std::variant<std::nullptr_t, double, std::int64_t, std::string, Bytes>;
using SqlRow = std::map<std::string, SqlValue>;

struct D1Result {
  std::vector<SqlRow> rows;
  // Preserve evolving platform metadata without inventing a fixed schema.
  std::string metadata_json;
};

namespace detail {
inline void append_u32(Bytes& bytes, std::uint32_t value) {
  for (int shift = 0; shift != 32; shift += 8)
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
inline void append_field(Bytes& bytes, std::string_view value) {
  append_u32(bytes, static_cast<std::uint32_t>(value.size()));
  bytes.insert(bytes.end(), value.begin(), value.end());
}
inline Result<Bytes> encode_sql_values(const std::vector<SqlValue>& values) {
  if (values.size() > 100) return Result<Bytes>::failure({ErrorCode::ResourceLimit, "too many SQL parameters"});
  Bytes bytes;
  append_u32(bytes, static_cast<std::uint32_t>(values.size()));
  for (const auto& value : values) {
    if (std::holds_alternative<std::nullptr_t>(value)) {
      append_u32(bytes, 0);
    } else if (std::holds_alternative<double>(value) || std::holds_alternative<std::int64_t>(value)) {
      double number;
      if (const auto* integer = std::get_if<std::int64_t>(&value)) {
        constexpr std::int64_t max_safe = 9007199254740991LL;
        if (*integer < -max_safe || *integer > max_safe)
          return Result<Bytes>::failure({ErrorCode::InvalidInput, "SQL integer exceeds JavaScript precision"});
        number = static_cast<double>(*integer);
      } else {
        number = std::get<double>(value);
      }
      if (!std::isfinite(number)) return Result<Bytes>::failure({ErrorCode::InvalidInput, "non-finite SQL number"});
      append_u32(bytes, 1);
      const auto bits = std::bit_cast<std::uint64_t>(number);
      append_u32(bytes, static_cast<std::uint32_t>(bits));
      append_u32(bytes, static_cast<std::uint32_t>(bits >> 32));
    } else if (const auto* text = std::get_if<std::string>(&value)) {
      if (text->size() > 1024 * 1024) return Result<Bytes>::failure({ErrorCode::ResourceLimit, "SQL text too large"});
      append_u32(bytes, 2);
      append_field(bytes, *text);
    } else {
      const auto& blob = std::get<Bytes>(value);
      if (blob.size() > 1024 * 1024) return Result<Bytes>::failure({ErrorCode::ResourceLimit, "SQL blob too large"});
      append_u32(bytes, 3);
      append_u32(bytes, static_cast<std::uint32_t>(blob.size()));
      bytes.insert(bytes.end(), blob.begin(), blob.end());
    }
    if (bytes.size() > 1024 * 1024) return Result<Bytes>::failure({ErrorCode::ResourceLimit, "SQL parameters too large"});
  }
  return Result<Bytes>::success(std::move(bytes));
}

inline bool read_sql_value(WireReader& reader, SqlValue& value) {
  std::uint32_t tag = 0;
  if (!reader.u32(tag)) return false;
  switch (tag) {
    case 0: value = nullptr; return true;
    case 1: {
      std::uint32_t low = 0, high = 0;
      if (!reader.u32(low) || !reader.u32(high)) return false;
      const double number = std::bit_cast<double>((static_cast<std::uint64_t>(high) << 32) | low);
      if (!std::isfinite(number)) return false;
      value = number;
      return true;
    }
    case 2: {
      std::string text;
      if (!reader.string(text)) return false;
      value = std::move(text);
      return true;
    }
    case 3: {
      Bytes bytes;
      if (!reader.bytes(bytes)) return false;
      value = std::move(bytes);
      return true;
    }
    default: return false;
  }
}

inline Result<D1Result> decode_d1(OperationReply reply) {
  const auto invalid = [] { return Result<D1Result>::failure({ErrorCode::InvalidInput, "malformed D1 result"}); };
  if (reply.kind != ReplyKind::Value) return invalid();
  WireReader reader(reply.bytes);
  D1Result result;
  std::uint32_t count = 0;
  if (!reader.string(result.metadata_json) || !reader.u32(count) || count > reply.bytes.size() / 4)
    return invalid();
  for (std::uint32_t row_index = 0; row_index < count; ++row_index) {
    std::uint32_t columns = 0;
    if (!reader.u32(columns) || columns > reply.bytes.size() / 8) return invalid();
    SqlRow row;
    for (std::uint32_t column = 0; column < columns; ++column) {
      std::string name;
      SqlValue value;
      if (!reader.string(name) || !read_sql_value(reader, value) || !row.emplace(std::move(name), std::move(value)).second)
        return invalid();
    }
    result.rows.push_back(std::move(row));
  }
  if (!reader.done()) return invalid();
  return Result<D1Result>::success(std::move(result));
}
}  // namespace detail

class D1Statement {
 public:
  D1Statement(BindingRuntime runtime, std::string binding, std::string sql)
      : runtime_(std::move(runtime)), binding_(std::move(binding)), sql_(std::move(sql)) {}

  [[nodiscard]] D1Statement bind(std::vector<SqlValue> values) const {
    D1Statement statement = *this;
    statement.values_ = std::move(values);
    return statement;
  }
  [[nodiscard]] AsyncResult<D1Result> all() const { return execute(Operation::D1All); }
  [[nodiscard]] AsyncResult<D1Result> run() const { return execute(Operation::D1Run); }

 private:
  AsyncResult<D1Result> execute(Operation method) const {
    auto bytes = detail::encode_sql_values(values_);
    if (!bytes) {
      return AsyncResult<D1Result>([error = bytes.error()](auto done) {
        done(Result<D1Result>::failure(error));
      }, [](std::coroutine_handle<>) {});
    }
    return runtime_.call<D1Result>({method, binding_, sql_, std::move(bytes.value()), {}}, detail::decode_d1);
  }
  BindingRuntime runtime_;
  std::string binding_;
  std::string sql_;
  std::vector<SqlValue> values_;
};

class D1Database {
 public:
  D1Database(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] D1Statement prepare(std::string sql) const {
    return D1Statement(runtime_, binding_, std::move(sql));
  }
  // exec is for application-controlled schema/setup SQL, not interpolation of
  // request data. Use prepare().bind() for all user-supplied values.
  [[nodiscard]] AsyncResult<D1Result> exec(std::string sql) const {
    return runtime_.call<D1Result>({Operation::D1Exec, binding_, std::move(sql), {}, {}}, detail::decode_d1);
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};

}  // namespace libcf
