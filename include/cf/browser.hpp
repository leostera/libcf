#pragma once
#include <chrono>
#include "cf/detail/text.hpp"
#include "cf/operation.hpp"

namespace cf {
struct BrowserScreenshotRequest {
  std::string html;
  std::uint32_t width = 128;
  std::uint32_t height = 128;
  std::chrono::milliseconds timeout{5000};
};

class BrowserRun {
 public:
  BrowserRun(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  // HTML-only, binary PNG, fixed viewport; requests disabled JS/subresources and
  // cache. These settings are not verified isolation. Local wait/byte limits do
  // not bound native rendering memory or promise stopped work/billing on cancel.
  [[nodiscard]] AsyncResult<Bytes> screenshot_html_png(const BrowserScreenshotRequest& request) const {
    const auto timeout = request.timeout.count();
    if (!detail::bounded_utf8(request.html, 1, 65536) || request.width < 1 || request.width > 512 ||
        request.height < 1 || request.height > 512 || timeout < 1 || timeout > 60000)
      return AsyncResult<Bytes>([](auto complete) {
        complete(Result<Bytes>::failure({ErrorCode::InvalidInput, "invalid Browser screenshot request"}));
      }, [](std::coroutine_handle<>) {});
    auto options = std::to_string(request.width) + ":" + std::to_string(request.height) + ":" + std::to_string(timeout);
    // Snapshot before returning: no caller reference survives into the operation.
    return runtime_.call<Bytes>(
        {Operation::BrowserScreenshotHtmlPng, binding_, {}, Bytes(request.html.begin(), request.html.end()), std::move(options)},
        [](OperationReply reply) {
          auto invalid = [] { return Result<Bytes>::failure({ErrorCode::HostFailure, "invalid Browser PNG reply"}); };
          constexpr std::uint8_t signature[] = {137, 80, 78, 71, 13, 10, 26, 10};
          if (reply.kind != ReplyKind::Value || reply.bytes.size() < 8 || reply.bytes.size() > 1048576)
            return invalid();
          for (std::size_t i = 0; i < 8; ++i) if (reply.bytes[i] != signature[i]) return invalid();
          // Transport checks only, not PNG decoding, dimensions or rendered pixels.
          return Result<Bytes>::success(std::move(reply.bytes));
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
