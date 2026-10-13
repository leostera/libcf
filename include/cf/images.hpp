#pragma once
#include <variant>
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"
namespace cf {
struct SvgImageInfo {};
struct RasterImageInfo {
  std::string media_type;
  std::uint32_t file_size = 0;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
};
using ImageInfo = std::variant<SvgImageInfo, RasterImageInfo>;
class Images {
 public:
  Images(BindingRuntime runtime, std::string binding) : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] AsyncResult<ImageInfo> info(Bytes image) const {
    if (image.empty() || image.size() > 1048576)
      return AsyncResult<ImageInfo>([](auto complete) {
        complete(Result<ImageInfo>::failure({ErrorCode::InvalidInput, "image must contain 1..1048576 bytes"}));
      }, [](std::coroutine_handle<>) {});
    return runtime_.call<ImageInfo>({Operation::ImageInfoGet, binding_, {}, std::move(image), {}},
        [](OperationReply reply) {
          auto invalid = [] { return Result<ImageInfo>::failure({ErrorCode::HostFailure, "invalid image info"}); };
          if (reply.kind != ReplyKind::Value || reply.bytes.size() > 148) return invalid();
          detail::WireReader wire(reply.bytes);
          std::uint32_t tag = 0;
          if (!wire.u32(tag)) return invalid();
          if (tag == 0 && wire.done()) return Result<ImageInfo>::success(SvgImageInfo{});
          RasterImageInfo result;
          if (tag != 1 || !wire.u32(result.file_size) || !wire.u32(result.width) || !wire.u32(result.height) ||
              !wire.string(result.media_type) || !wire.done() || !result.file_size || result.file_size > 1048576 ||
              !result.width || !result.height || result.media_type.size() <= 6 || result.media_type.size() > 128 ||
              !result.media_type.starts_with("image/") || result.media_type == "image/svg+xml") return invalid();
          for (const unsigned char c : std::string_view(result.media_type).substr(6))
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-')) return invalid();
          return Result<ImageInfo>::success(std::move(result));
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
