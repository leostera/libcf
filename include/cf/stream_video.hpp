#pragma once
#include <bit>
#include <chrono>
#include <cmath>
#include <limits>
#include <optional>
#include "cf/detail/text.hpp"
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
struct StreamVideoListRequest {
  std::uint32_t limit = 10;
  std::chrono::milliseconds timeout{5000};
};
struct StreamVideoDetailsRequest {
  std::string id;
  std::chrono::milliseconds timeout{5000};
};
struct StreamVideoInfo {
  std::string id;
  std::string state;
  bool ready_to_stream = false;
  std::uint64_t size_bytes = 0;
  std::optional<std::chrono::duration<double>> duration;
};

class StreamVideoLibrary {
 public:
  StreamVideoLibrary(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  // A bounded first page, not a complete inventory or tenant authorization.
  [[nodiscard]] AsyncResult<std::vector<StreamVideoInfo>> list(StreamVideoListRequest request = {}) const {
    const auto timeout = request.timeout.count();
    if (request.limit < 1 || request.limit > 50 || timeout < 1 || timeout > 60000)
      return invalid_request<std::vector<StreamVideoInfo>>();
    return runtime_.call<std::vector<StreamVideoInfo>>(
        {Operation::StreamVideoList, binding_, {}, {}, std::to_string(request.limit) + ":" + std::to_string(timeout)},
        [limit = request.limit](OperationReply reply) { return decode(std::move(reply), limit); });
  }
  [[nodiscard]] AsyncResult<StreamVideoInfo> details(const StreamVideoDetailsRequest& request) const {
    const auto timeout = request.timeout.count();
    if (!valid_id(request.id) || timeout < 1 || timeout > 60000) return invalid_request<StreamVideoInfo>();
    return runtime_.call<StreamVideoInfo>(
        {Operation::StreamVideoDetails, binding_, request.id, {}, std::to_string(timeout)},
        [id = request.id](OperationReply reply) {
          auto result = decode(std::move(reply), 1);
          if (!result) return Result<StreamVideoInfo>::failure(result.error());
          if (result.value().size() != 1 || result.value()[0].id != id)
            return Result<StreamVideoInfo>::failure({ErrorCode::HostFailure, "invalid Stream details reply"});
          return Result<StreamVideoInfo>::success(std::move(result.value()[0]));
        });
  }
 private:
  template <class T> static AsyncResult<T> invalid_request() {
    return AsyncResult<T>([](auto complete) {
      complete(Result<T>::failure({ErrorCode::InvalidInput, "invalid Stream metadata request"}));
    }, [](std::coroutine_handle<>) {});
  }
  static bool valid_id(std::string_view id) {
    if (id.empty() || id.size() > 128) return false;
    for (unsigned char c : id)
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
    return true;
  }
  static Result<std::vector<StreamVideoInfo>> decode(OperationReply reply, std::uint32_t limit) {
    static_assert(sizeof(double) == 8 && std::numeric_limits<double>::is_iec559);
    auto invalid = [] {
      return Result<std::vector<StreamVideoInfo>>::failure({ErrorCode::HostFailure, "invalid Stream metadata reply"});
    };
    if (reply.kind != ReplyKind::Value || reply.bytes.size() > 4 + limit * 220) return invalid();
    detail::WireReader wire(reply.bytes);
    std::uint32_t count = 0;
    if (!wire.u32(count) || count > limit) return invalid();
    std::vector<StreamVideoInfo> videos;
    videos.reserve(count);
    for (std::uint32_t i = 0; i < count; ++i) {
      StreamVideoInfo video;
      std::uint32_t ready = 0, size_low = 0, size_high = 0, duration_low = 0, duration_high = 0;
      if (!wire.string(video.id) || !valid_id(video.id) || !wire.string(video.state) ||
          !detail::bounded_utf8(video.state, 1, 64) || !wire.u32(ready) || ready > 1 ||
          !wire.u32(size_low) || !wire.u32(size_high) || !wire.u32(duration_low) || !wire.u32(duration_high)) return invalid();
      video.ready_to_stream = ready == 1;
      video.size_bytes = (static_cast<std::uint64_t>(size_high) << 32) | size_low;
      const double duration = std::bit_cast<double>((static_cast<std::uint64_t>(duration_high) << 32) | duration_low);
      if (video.size_bytes > 9007199254740991ULL || !std::isfinite(duration) || (duration < 0 && duration != -1)) return invalid();
      if (duration != -1) video.duration = std::chrono::duration<double>(duration);
      videos.push_back(std::move(video));
    }
    if (!wire.done()) return invalid();
    return Result<std::vector<StreamVideoInfo>>::success(std::move(videos));
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
