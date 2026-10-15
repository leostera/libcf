#pragma once

#include <bit>
#include <cmath>
#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
using SqlValue = std::variant<std::nullptr_t, double, std::int64_t, std::string, Bytes>;
using SqlRow = std::map<std::string, SqlValue>;
struct SqlResult {
  std::vector<SqlRow> rows;
  // Metadata is platform-specific: D1 and DO SQLite report different fields.
  std::string metadata_json;
};
struct SqlCommand {
  std::string sql;
  std::vector<SqlValue> parameters;
};

namespace detail {
template <typename T>
AsyncResult<T> failed_sql(Error error) {
  return AsyncResult<T>([error = std::move(error)](auto done) { done(Result<T>::failure(error)); },
                        [](std::coroutine_handle<>) {});
}
inline void append_u32(Bytes& bytes, std::uint32_t value) {
  for (int shift = 0; shift != 32; shift += 8)
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
inline void append_field(Bytes& bytes, std::string_view value) {
  append_u32(bytes, static_cast<std::uint32_t>(value.size()));
  bytes.insert(bytes.end(), value.begin(), value.end());
}
inline Result<Bytes> encode_sql_values(const std::vector<SqlValue>& values) {
  if (values.size() > 100)
    return Result<Bytes>::failure({ErrorCode::ResourceLimit, "too many SQL parameters"});
  Bytes bytes;
  append_u32(bytes, static_cast<std::uint32_t>(values.size()));
  for (const auto& value : values) {
    if (std::holds_alternative<std::nullptr_t>(value)) {
      append_u32(bytes, 0);
    } else if (std::holds_alternative<double>(value) ||
               std::holds_alternative<std::int64_t>(value)) {
      double number;
      if (const auto* integer = std::get_if<std::int64_t>(&value)) {
        constexpr std::int64_t max_safe = 9007199254740991LL;
        if (*integer < -max_safe || *integer > max_safe)
          return Result<Bytes>::failure(
              {ErrorCode::InvalidInput, "SQL integer exceeds JavaScript precision"});
        number = static_cast<double>(*integer);
      } else {
        number = std::get<double>(value);
      }
      if (!std::isfinite(number))
        return Result<Bytes>::failure({ErrorCode::InvalidInput, "non-finite SQL number"});
      append_u32(bytes, 1);
      const auto bits = std::bit_cast<std::uint64_t>(number);
      append_u32(bytes, static_cast<std::uint32_t>(bits));
      append_u32(bytes, static_cast<std::uint32_t>(bits >> 32));
    } else if (const auto* text = std::get_if<std::string>(&value)) {
      if (text->size() > 1024 * 1024)
        return Result<Bytes>::failure({ErrorCode::ResourceLimit, "SQL text too large"});
      append_u32(bytes, 2);
      append_field(bytes, *text);
    } else {
      const auto& blob = std::get<Bytes>(value);
      if (blob.size() > 1024 * 1024)
        return Result<Bytes>::failure({ErrorCode::ResourceLimit, "SQL blob too large"});
      append_u32(bytes, 3);
      append_u32(bytes, static_cast<std::uint32_t>(blob.size()));
      bytes.insert(bytes.end(), blob.begin(), blob.end());
    }
    if (bytes.size() > 1024 * 1024)
      return Result<Bytes>::failure({ErrorCode::ResourceLimit, "SQL parameters too large"});
  }
  return Result<Bytes>::success(std::move(bytes));
}
inline bool read_sql_value(WireReader& reader, SqlValue& value) {
  std::uint32_t tag = 0;
  if (!reader.u32(tag)) return false;
  switch (tag) {
    case 0:
      value = nullptr;
      return true;
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
    default:
      return false;
  }
}
inline Result<SqlResult> decode_sql(OperationReply reply) {
  const auto invalid = [] {
    return Result<SqlResult>::failure({ErrorCode::InvalidInput, "malformed SQL result"});
  };
  if (reply.kind != ReplyKind::Value) return invalid();
  WireReader reader(reply.bytes);
  SqlResult result;
  std::uint32_t count = 0;
  if (!reader.string(result.metadata_json) || !reader.u32(count) || count > reader.remaining() / 4)
    return invalid();
  for (std::uint32_t i = 0; i < count; ++i) {
    std::uint32_t columns = 0;
    if (!reader.u32(columns) || columns > reader.remaining() / 8) return invalid();
    SqlRow row;
    for (std::uint32_t column = 0; column < columns; ++column) {
      std::string name;
      SqlValue value;
      if (!reader.string(name) || !read_sql_value(reader, value) ||
          !row.emplace(std::move(name), std::move(value)).second)
        return invalid();
    }
    result.rows.push_back(std::move(row));
  }
  if (!reader.done()) return invalid();
  return Result<SqlResult>::success(std::move(result));
}
inline Result<Bytes> encode_sql_commands(const std::vector<SqlCommand>& commands) {
  if (commands.empty() || commands.size() > 100)
    return Result<Bytes>::failure({ErrorCode::InvalidInput, "batch requires 1 to 100 statements"});
  Bytes wire;
  append_u32(wire, static_cast<std::uint32_t>(commands.size()));
  for (const auto& command : commands) {
    if (command.sql.size() > 65536)
      return Result<Bytes>::failure({ErrorCode::ResourceLimit, "batch SQL exceeds bridge limit"});
    auto values = encode_sql_values(command.parameters);
    if (!values) return Result<Bytes>::failure(values.error());
    if (wire.size() + command.sql.size() + values.value().size() + 8 > 1024 * 1024)
      return Result<Bytes>::failure({ErrorCode::ResourceLimit, "batch exceeds bridge limit"});
    append_field(wire, command.sql);
    append_u32(wire, static_cast<std::uint32_t>(values.value().size()));
    wire.insert(wire.end(), values.value().begin(), values.value().end());
  }
  return Result<Bytes>::success(std::move(wire));
}
inline Result<std::vector<SqlResult>> decode_sql_batch(OperationReply reply, std::size_t expected) {
  const auto invalid = [] {
    return Result<std::vector<SqlResult>>::failure(
        {ErrorCode::InvalidInput, "malformed SQL batch reply"});
  };
  if (reply.kind != ReplyKind::Value) return invalid();
  WireReader reader(reply.bytes);
  std::uint32_t count = 0;
  if (!reader.u32(count) || count != expected) return invalid();
  std::vector<SqlResult> results;
  for (std::uint32_t i = 0; i < count; ++i) {
    Bytes encoded;
    if (!reader.bytes(encoded)) return invalid();
    auto result = decode_sql({ReplyKind::Value, std::move(encoded)});
    if (!result) return Result<std::vector<SqlResult>>::failure(result.error());
    results.push_back(std::move(result.value()));
  }
  if (!reader.done()) return invalid();
  return Result<std::vector<SqlResult>>::success(std::move(results));
}
}  // namespace detail
}  // namespace cf
