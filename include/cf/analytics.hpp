#pragma once

#include <bit>
#include <cmath>
#include <limits>
#include <optional>
#include <variant>
#include "cf/operation.hpp"

namespace cf {
using AnalyticsBlob = std::variant<std::nullptr_t, std::string, Bytes>;
struct AnalyticsDataPoint {
  std::vector<AnalyticsBlob> blobs;
  std::vector<double> doubles;
  std::optional<AnalyticsBlob> index;
};

namespace detail {
inline std::size_t analytics_size(const AnalyticsBlob& blob) {
  if (const auto* text = std::get_if<std::string>(&blob)) return text->size();
  if (const auto* bytes = std::get_if<Bytes>(&blob)) return bytes->size();
  return 0;
}
inline void analytics_u32(Bytes& wire, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) wire.push_back(static_cast<std::uint8_t>(value >> shift));
}
inline void analytics_blob(Bytes& wire, const AnalyticsBlob& blob) {
  // Counts/lengths are validated before encoding; variant order defines tags.
  analytics_u32(wire, static_cast<std::uint32_t>(blob.index()));
  analytics_u32(wire, static_cast<std::uint32_t>(analytics_size(blob)));
  if (const auto* text = std::get_if<std::string>(&blob)) wire.insert(wire.end(), text->begin(), text->end());
  if (const auto* bytes = std::get_if<Bytes>(&blob)) wire.insert(wire.end(), bytes->begin(), bytes->end());
}
inline Result<Bytes> encode_analytics(const AnalyticsDataPoint& point) {
  const auto invalid = [] { return Result<Bytes>::failure({ErrorCode::InvalidInput, "invalid analytics point or limits"}); };
  if (point.blobs.size() > 20 || point.doubles.size() > 20 ||
      (point.index && analytics_size(*point.index) > 96)) return invalid();
  std::size_t total = 0;
  for (const auto& blob : point.blobs) {
    const auto size = analytics_size(blob);
    if (size > 16384 - total) return invalid();
    total += size;
  }
  for (double value : point.doubles) if (!std::isfinite(value)) return invalid();
  static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);
  Bytes wire;
  analytics_u32(wire, static_cast<std::uint32_t>(point.doubles.size()));
  for (double value : point.doubles) {
    const auto bits = std::bit_cast<std::uint64_t>(value);
    analytics_u32(wire, static_cast<std::uint32_t>(bits));
    analytics_u32(wire, static_cast<std::uint32_t>(bits >> 32));
  }
  analytics_u32(wire, static_cast<std::uint32_t>(point.blobs.size()));
  for (const auto& blob : point.blobs) analytics_blob(wire, blob);
  analytics_u32(wire, point.index ? 1 : 0);
  if (point.index) analytics_blob(wire, *point.index);
  return Result<Bytes>::success(std::move(wire));
}
}  // namespace detail

class AnalyticsEngine {
 public:
  AnalyticsEngine(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] AsyncResult<Unit> write(AnalyticsDataPoint point) const {
    auto wire = detail::encode_analytics(point);
    if (!wire) return AsyncResult<Unit>([error = wire.error()](auto done) {
      done(Result<Unit>::failure(error));
    }, [](std::coroutine_handle<>) {});
    return runtime_.call<Unit>({Operation::AnalyticsWriteDataPoint, binding_, {}, std::move(wire.value()), {}},
        [](OperationReply reply) {
          if (reply.kind != ReplyKind::Value || !reply.bytes.empty())
            return Result<Unit>::failure({ErrorCode::HostFailure, "invalid analytics acknowledgement"});
          return Result<Unit>::success({});
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
