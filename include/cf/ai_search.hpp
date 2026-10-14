#pragma once
#include <bit>
#include <chrono>
#include <cmath>
#include <limits>
#include <string_view>
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
struct AiSearchKeywordQuery {
  std::string text;
  std::uint32_t max_results = 5;
  std::chrono::milliseconds timeout{5000};
};
struct AiSearchTextMatch {
  std::string id;
  double score;
  std::string source_key;
  std::string text;
};

class AiSearch {
 public:
  AiSearch(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  // Direct-instance keyword AND retrieval only. Native parsing/work precedes
  // these owned-result caps; a local deadline does not cancel provider usage.
  [[nodiscard]] AsyncResult<std::vector<AiSearchTextMatch>> keyword_search(const AiSearchKeywordQuery& request) const {
    static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);
    const auto timeout = request.timeout.count();
    if (!text_field(request.text, 1, 4096) || request.max_results < 1 || request.max_results > 50 ||
        timeout < 1 || timeout > 60000)
      return AsyncResult<std::vector<AiSearchTextMatch>>([](auto complete) {
        complete(Result<std::vector<AiSearchTextMatch>>::failure(
            {ErrorCode::InvalidInput, "invalid AI Search query"}));
      }, [](std::coroutine_handle<>) {});
    // Snapshot before returning the async operation; no request reference escapes.
    Bytes body(request.text.begin(), request.text.end());
    auto options = std::to_string(request.max_results) + ":" + std::to_string(timeout);
    return runtime_.call<std::vector<AiSearchTextMatch>>(
        {Operation::AiSearchKeywordQuery, binding_, {}, std::move(body), std::move(options)},
        [limit = request.max_results](OperationReply reply) { return decode(std::move(reply), limit); });
  }
 private:
  // Preserve Unicode scalar values exactly, including BOM and NUL; reject
  // overlong encodings, surrogates and truncated/out-of-range sequences.
  static bool text_field(std::string_view text, std::size_t minimum, std::size_t maximum) {
    if (text.size() < minimum || text.size() > maximum) return false;
    for (std::size_t i = 0; i < text.size();) {
      auto lead = static_cast<std::uint8_t>(text[i++]);
      if (lead < 0x80) continue;
      std::uint32_t value = 0, floor = 0;
      unsigned tail = 0;
      if (lead >= 0xc2 && lead <= 0xdf) { value = lead & 0x1f; floor = 0x80; tail = 1; }
      else if (lead >= 0xe0 && lead <= 0xef) { value = lead & 0x0f; floor = 0x800; tail = 2; }
      else if (lead >= 0xf0 && lead <= 0xf4) { value = lead & 0x07; floor = 0x10000; tail = 3; }
      else return false;
      if (text.size() - i < tail) return false;
      for (unsigned n = 0; n < tail; ++n) {
        auto next = static_cast<std::uint8_t>(text[i++]);
        if ((next & 0xc0) != 0x80) return false;
        value = (value << 6) | (next & 0x3f);
      }
      if (value < floor || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return false;
    }
    return true;
  }
  static Result<std::vector<AiSearchTextMatch>> decode(OperationReply reply, std::uint32_t limit) {
    auto invalid = [] {
      return Result<std::vector<AiSearchTextMatch>>::failure(
          {ErrorCode::HostFailure, "invalid AI Search reply"});
    };
    // Aggregate cap also bounds allocations while rejecting malformed fields.
    if (reply.kind != ReplyKind::Value || reply.bytes.size() > 4 + limit * 18708) return invalid();
    detail::WireReader wire(reply.bytes);
    std::uint32_t count = 0;
    if (!wire.u32(count) || count > limit) return invalid();
    std::vector<AiSearchTextMatch> matches;
    matches.reserve(count);
    for (std::uint32_t i = 0; i < count; ++i) {
      AiSearchTextMatch match;
      std::uint32_t low = 0, high = 0;
      if (!wire.string(match.id) || !text_field(match.id, 1, 256) || !wire.u32(low) || !wire.u32(high) ||
          !wire.string(match.source_key) || !text_field(match.source_key, 1, 2048) ||
          !wire.string(match.text) || !text_field(match.text, 0, 16384)) return invalid();
      match.score = std::bit_cast<double>((static_cast<std::uint64_t>(high) << 32) | low);
      if (!std::isfinite(match.score) || match.score < 0 || match.score > 1) return invalid();
      matches.push_back(std::move(match));
    }
    if (!wire.done()) return invalid();
    return Result<std::vector<AiSearchTextMatch>>::success(std::move(matches));
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
