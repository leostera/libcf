#pragma once
#include <bit>
#include <charconv>
#include <chrono>
#include <cmath>
#include <limits>
#include <map>
#include <optional>
#include <variant>
#include "cf/detail/text.hpp"
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
using AnalyticsSqlScalar = std::variant<std::nullptr_t, bool, double, std::string>;
using AnalyticsSqlPositionalParameters = std::vector<AnalyticsSqlScalar>;
using AnalyticsSqlNamedParameters = std::map<std::string, AnalyticsSqlScalar>;
using AnalyticsSqlParameters = std::variant<AnalyticsSqlPositionalParameters, AnalyticsSqlNamedParameters>;
struct AnalyticsSqlQuery { std::string statement; std::optional<AnalyticsSqlParameters> parameters; };
struct AnalyticsSqlOptions { std::uint32_t row_limit = 100; std::chrono::milliseconds timeout{5000}; };
struct AnalyticsSqlColumn { std::string name; AnalyticsSqlScalar value; };
using AnalyticsSqlRow = std::vector<AnalyticsSqlColumn>;
struct AnalyticsSqlStatistics {
  std::chrono::duration<double, std::milli> elapsed{};
  std::uint64_t rows_read = 0;
  std::uint64_t bytes_read = 0;
};
struct AnalyticsSqlResult { std::vector<AnalyticsSqlRow> rows; AnalyticsSqlStatistics statistics; };

class AnalyticsSql {
 public:
  AnalyticsSql(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  // Row limit caps projection, not scan cost or authorization. No SQL rewrite or
  // automatic retries. Generic host errors do not expose provider retryability.
  [[nodiscard]] AsyncResult<AnalyticsSqlResult> query(
      const AnalyticsSqlQuery& query, const AnalyticsSqlOptions& options = {}) const {
    const auto timeout = options.timeout.count();
    if (!detail::bounded_utf8(query.statement, 1, 10240) || options.row_limit < 1 || options.row_limit > 100 || timeout < 1 || timeout > 60000)
      return invalid_request();
    auto parameters = encode_parameters(query.parameters);
    if (!parameters) return invalid_request();
    return runtime_.call<AnalyticsSqlResult>(
        {Operation::AnalyticsSqlQuery, binding_, query.statement, std::move(*parameters),
         std::to_string(options.row_limit) + ":" + std::to_string(timeout)},
        [limit = options.row_limit](OperationReply reply) { return decode(std::move(reply), limit); });
  }
 private:
  static constexpr std::uint64_t max_safe = 9007199254740991ULL;
  static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);
  static bool number(double value) {
    return std::isfinite(value) && (std::trunc(value) != value || std::abs(value) <= static_cast<double>(max_safe));
  }
  static AsyncResult<AnalyticsSqlResult> invalid_request() {
    return AsyncResult<AnalyticsSqlResult>([](auto done) {
      done(Result<AnalyticsSqlResult>::failure({ErrorCode::InvalidInput, "invalid Analytics SQL request"}));
    }, [](std::coroutine_handle<>) {});
  }
  static bool parameter_name(std::string_view name) {
    if (name.empty() || name.size() > 64) return false;
    const auto letter = [](unsigned char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'; };
    if (!letter(static_cast<unsigned char>(name.front()))) return false;
    for (unsigned char c : name) if (!letter(c) && !(c >= '0' && c <= '9')) return false;
    return true;
  }
  // Bounded JSON encoder for scalar parameters, never arbitrary caller JSON.
  class ParameterEncoder {
   public:
    Bytes bytes;
    bool append(std::string_view value) {
      if (value.size() > 65536 - bytes.size()) return false;
      bytes.insert(bytes.end(), value.begin(), value.end()); return true;
    }
    bool quote(std::string_view value) {
      if (!detail::bounded_utf8(value, 0, 4096) || !append("\"")) return false;
      constexpr char hex[] = "0123456789abcdef";
      for (unsigned char c : value) {
        if (c < 0x20) {
          const char escape[] = {'\\', 'u', '0', '0', hex[c >> 4], hex[c & 15]};
          if (!append(std::string_view(escape, 6))) return false;
        } else {
          if ((c == '"' || c == '\\') && !append("\\")) return false;
          const char byte = static_cast<char>(c);
          if (!append(std::string_view(&byte, 1))) return false;
        }
      }
      return append("\"");
    }
    bool scalar(const AnalyticsSqlScalar& value) {
      if (value.valueless_by_exception()) return false;
      if (std::holds_alternative<std::nullptr_t>(value)) return append("null");
      if (const auto* boolean = std::get_if<bool>(&value)) return append(*boolean ? "true" : "false");
      if (const auto* numeric = std::get_if<double>(&value)) {
        if (!number(*numeric)) return false;
        char buffer[64];
        const auto [end, error] = std::to_chars(buffer, buffer + sizeof(buffer), *numeric, std::chars_format::general);
        return error == std::errc{} && append(std::string_view(buffer, static_cast<std::size_t>(end - buffer)));
      }
      return quote(std::get<std::string>(value));
    }
  };
  static std::optional<Bytes> encode_parameters(const std::optional<AnalyticsSqlParameters>& parameters) {
    if (!parameters) return Bytes{};
    if (parameters->valueless_by_exception()) return std::nullopt;
    ParameterEncoder encoder;
    if (const auto* values = std::get_if<AnalyticsSqlPositionalParameters>(&*parameters)) {
      if (values->size() > 100 || !encoder.append("[")) return std::nullopt;
      bool first = true;
      for (const auto& value : *values) {
        if ((!first && !encoder.append(",")) || !encoder.scalar(value)) return std::nullopt;
        first = false;
      }
      if (!encoder.append("]")) return std::nullopt;
    } else {
      const auto& named = std::get<AnalyticsSqlNamedParameters>(*parameters);
      if (named.size() > 100 || !encoder.append("{")) return std::nullopt;
      bool first = true;
      for (const auto& [name, value] : named) {
        if (!parameter_name(name) || (!first && !encoder.append(",")) || !encoder.quote(name) ||
            !encoder.append(":") || !encoder.scalar(value)) return std::nullopt;
        first = false;
      }
      if (!encoder.append("}")) return std::nullopt;
    }
    return std::move(encoder.bytes);
  }
  static bool u64(detail::WireReader& wire, std::uint64_t& value) {
    std::uint32_t low = 0, high = 0;
    if (!wire.u32(low) || !wire.u32(high)) return false;
    value = (static_cast<std::uint64_t>(high) << 32) | low; return true;
  }
  static bool f64(detail::WireReader& wire, double& value) {
    std::uint64_t bits = 0; if (!u64(wire, bits)) return false;
    value = std::bit_cast<double>(bits); return true;
  }
  static bool scalar(detail::WireReader& wire, AnalyticsSqlScalar& value) {
    std::uint32_t tag = 0; if (!wire.u32(tag)) return false;
    switch (tag) {
      case 0: value = nullptr; return true;
      case 1: value = false; return true;
      case 2: value = true; return true;
      case 3: {
        double numeric = 0;
        if (!f64(wire, numeric) || !number(numeric)) return false;
        value = numeric; return true;
      }
      case 4: {
        std::string text;
        if (!wire.string(text) || !detail::bounded_utf8(text, 0, 4096)) return false;
        value = std::move(text); return true;
      }
      default: return false;
    }
  }
  static Result<AnalyticsSqlResult> decode(OperationReply reply, std::uint32_t limit) {
    const auto invalid = [] { return Result<AnalyticsSqlResult>::failure({ErrorCode::HostFailure, "invalid Analytics SQL reply"}); };
    if (reply.kind != ReplyKind::Value || reply.bytes.size() < 28 || reply.bytes.size() > 1048576) return invalid();
    detail::WireReader wire(reply.bytes); AnalyticsSqlResult result;
    std::uint32_t rows = 0; double elapsed = 0;
    if (!wire.u32(rows) || rows > limit || !f64(wire, elapsed) || !std::isfinite(elapsed) || elapsed < 0 || elapsed > static_cast<double>(max_safe) ||
        !u64(wire, result.statistics.rows_read) || result.statistics.rows_read > max_safe ||
        !u64(wire, result.statistics.bytes_read) || result.statistics.bytes_read > max_safe) return invalid();
    result.statistics.elapsed = std::chrono::duration<double, std::milli>(elapsed);
    result.rows.reserve(rows);
    for (std::uint32_t i = 0; i < rows; ++i) {
      std::uint32_t columns = 0; if (!wire.u32(columns) || columns > 64) return invalid();
      AnalyticsSqlRow row; row.reserve(columns);
      for (std::uint32_t j = 0; j < columns; ++j) {
        AnalyticsSqlColumn column;
        if (!wire.string(column.name) || !detail::bounded_utf8(column.name, 1, 128) || !scalar(wire, column.value)) return invalid();
        for (const auto& previous : row) if (previous.name == column.name) return invalid();
        row.push_back(std::move(column));
      }
      result.rows.push_back(std::move(row));
    }
    if (!wire.done()) return invalid();
    return Result<AnalyticsSqlResult>::success(std::move(result));
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
