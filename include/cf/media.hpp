#pragma once
#include <chrono>
#include "cf/operation.hpp"

namespace cf {
struct MediaFrameRequest {
  Bytes video;
  std::uint32_t width = 128;
  std::uint32_t height = 128;
  std::chrono::milliseconds timeout{5000};
};

class Media {
 public:
  Media(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  // First frame, PNG, contain fit. Limits bound SDK buffers and local wait, not
  // provider processing, image decoding memory, billing or remote cancellation.
  [[nodiscard]] AsyncResult<Bytes> frame_png(MediaFrameRequest request) const {
    const auto timeout = request.timeout.count();
    if (request.video.empty() || request.video.size() > 1048576 ||
        request.width < 10 || request.width > 512 || request.height < 10 || request.height > 512 ||
        timeout < 1 || timeout > 60000)
      return AsyncResult<Bytes>([](auto complete) {
        complete(Result<Bytes>::failure({ErrorCode::InvalidInput, "invalid Media frame request"}));
      }, [](std::coroutine_handle<>) {});
    auto options = std::to_string(request.width) + ":" + std::to_string(request.height) + ":" + std::to_string(timeout);
    return runtime_.call<Bytes>(
        {Operation::MediaFramePng, binding_, {}, std::move(request.video), std::move(options)},
        [](OperationReply reply) {
          auto invalid = [] { return Result<Bytes>::failure({ErrorCode::HostFailure, "invalid Media PNG reply"}); };
          constexpr std::uint8_t signature[] = {137, 80, 78, 71, 13, 10, 26, 10};
          if (reply.kind != ReplyKind::Value || reply.bytes.size() < 8 || reply.bytes.size() > 1048576)
            return invalid();
          for (std::size_t i = 0; i < 8; ++i) if (reply.bytes[i] != signature[i]) return invalid();
          // This checks the transport signature, not PNG decoding or actual dimensions.
          return Result<Bytes>::success(std::move(reply.bytes));
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
