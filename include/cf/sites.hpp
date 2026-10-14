#pragma once
#include <chrono>
#include <optional>
#include <string>
#include <string_view>
#include "cf/detail/text.hpp"
#include "cf/operation.hpp"

namespace cf {
struct LegacySitesReadOptions { std::chrono::milliseconds timeout{5000}; };
class LegacySites {
 public:
  explicit LegacySites(BindingRuntime runtime, std::string binding = "__STATIC_CONTENT")
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  // Exact logical key in the trusted deployment manifest configured in JS.
  // No URL decoding, raw-key fallback, writes or asset-serving/cache semantics.
  [[nodiscard]] AsyncResult<std::optional<Bytes>> get_bytes(
      std::string_view logical_key, const LegacySitesReadOptions& options = {}) const {
    const auto timeout = options.timeout.count();
    if (!valid_path(logical_key) || timeout < 1 || timeout > 60000)
      return AsyncResult<std::optional<Bytes>>([](auto done) {
        done(Result<std::optional<Bytes>>::failure({ErrorCode::InvalidInput, "invalid Sites read request"}));
      }, [](std::coroutine_handle<>) {});
    // Validate before bounded snapshots; caller mutation cannot change the call.
    return runtime_.call<std::optional<Bytes>>(
        {Operation::LegacySitesGet, binding_, std::string(logical_key), {}, std::to_string(timeout)},
        [](OperationReply reply) {
          if (reply.kind == ReplyKind::Missing && reply.bytes.empty())
            return Result<std::optional<Bytes>>::success(std::nullopt);
          if (reply.kind == ReplyKind::Value && reply.bytes.size() <= 1048576)
            return Result<std::optional<Bytes>>::success(std::optional<Bytes>(std::move(reply.bytes)));
          return Result<std::optional<Bytes>>::failure({ErrorCode::HostFailure, "invalid Sites read reply"});
        });
  }
 private:
  static bool valid_path(std::string_view key) {
    if (!detail::bounded_utf8(key, 1, 512) || key.find("\xef\xbb\xbf") != std::string_view::npos) return false;
    for (std::size_t i = 0; i < key.size(); ++i) {
      const auto c = static_cast<unsigned char>(key[i]);
      if (c < 32 || c == 127 || c == '\\' || c == '%' || c == ':' || c == '?' || c == '#') return false;
      // UTF-8 was checked above; C1 controls have exactly this two-byte encoding.
      if (c == 0xc2 && i + 1 < key.size()) {
        const auto next = static_cast<unsigned char>(key[i + 1]);
        if (next >= 0x80 && next <= 0x9f) return false;
      }
    }
    std::size_t start = 0;
    for (;;) {
      const auto end = key.find('/', start);
      const auto part = key.substr(start, end == std::string_view::npos ? end : end - start);
      if (part.empty() || part == "." || part == ".." || part.front() == ' ' || part.back() == ' ') return false;
      if (end == std::string_view::npos) return true;
      start = end + 1;
    }
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
