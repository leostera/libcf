#pragma once
#include <bit>
#include <chrono>
#include <cmath>
#include <limits>
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
struct VectorizeQuery {
  std::vector<float> values;
  std::uint32_t top_k = 5;
  std::chrono::milliseconds timeout{5000};
};
struct VectorizeMatch {
  std::string id;
  double score;
};

class Vectorize {
 public:
  Vectorize(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  // GA/V2 IDs and scores only. The native provider parses its own response before
  // our result cap. Timeout/cancellation do not stop provider work or reverse usage.
  [[nodiscard]] AsyncResult<std::vector<VectorizeMatch>> query(VectorizeQuery request) const {
    static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);
    static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);
    const auto timeout = request.timeout.count();
    bool valid = !request.values.empty() && request.values.size() <= 1536 &&
                 request.top_k >= 1 && request.top_k <= 100 && timeout >= 1 && timeout <= 60000;
    for (float value : request.values) valid = valid && std::isfinite(value);
    if (!valid)
      return AsyncResult<std::vector<VectorizeMatch>>([](auto complete) {
        complete(Result<std::vector<VectorizeMatch>>::failure(
            {ErrorCode::InvalidInput, "invalid Vectorize query"}));
      }, [](std::coroutine_handle<>) {});
    Bytes body;
    body.reserve(request.values.size() * 4);
    for (float value : request.values) {
      const auto bits = std::bit_cast<std::uint32_t>(value);
      for (unsigned shift = 0; shift < 32; shift += 8)
        body.push_back(static_cast<std::uint8_t>(bits >> shift));
    }
    auto options = std::to_string(request.top_k) + ":" + std::to_string(timeout);
    return runtime_.call<std::vector<VectorizeMatch>>(
        {Operation::VectorizeQuery, binding_, {}, std::move(body), std::move(options)},
        [limit = request.top_k](OperationReply reply) { return decode(std::move(reply), limit); });
  }
 private:
  static Result<std::vector<VectorizeMatch>> decode(OperationReply reply, std::uint32_t limit) {
    auto invalid = [] {
      return Result<std::vector<VectorizeMatch>>::failure(
          {ErrorCode::HostFailure, "invalid Vectorize reply"});
    };
    // count + at most limit * (ID length + 64 ID bytes + binary64 score).
    if (reply.kind != ReplyKind::Value || reply.bytes.size() > 4 + limit * 76) return invalid();
    detail::WireReader wire(reply.bytes);
    std::uint32_t count = 0;
    if (!wire.u32(count) || count > limit) return invalid();
    std::vector<VectorizeMatch> matches;
    matches.reserve(count);
    for (std::uint32_t i = 0; i < count; ++i) {
      VectorizeMatch match;
      std::uint32_t low = 0, high = 0;
      if (!wire.string(match.id) || match.id.empty() || match.id.size() > 64 ||
          !wire.u32(low) || !wire.u32(high)) return invalid();
      match.score = std::bit_cast<double>((static_cast<std::uint64_t>(high) << 32) | low);
      if (!std::isfinite(match.score)) return invalid();
      matches.push_back(std::move(match));
    }
    if (!wire.done()) return invalid();
    return Result<std::vector<VectorizeMatch>>::success(std::move(matches));
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
