#pragma once
#include <variant>
#include <array>
#include <chrono>
#include <optional>
#include <span>
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
struct ImageRotateOptions {
  std::chrono::milliseconds timeout{5000};
};
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
  [[nodiscard]] AsyncResult<Bytes> rotate_png90(
      std::span<const std::uint8_t> image, const ImageRotateOptions& options = {}) const {
    const auto dimensions = rotation_dimensions(image);
    const auto timeout = options.timeout.count();
    if (!dimensions || timeout < 1 || timeout > 60000)
      return AsyncResult<Bytes>([](auto complete) {
        complete(Result<Bytes>::failure({ErrorCode::InvalidInput, "invalid rotation PNG or timeout"}));
      }, [](std::coroutine_handle<>) {});
    // Copy only after bounded validation. Neither the caller's span/options nor
    // this client may be retained by the asynchronous operation or decoder.
    return runtime_.call<Bytes>(
        {Operation::ImageRotatePng90, binding_, {}, Bytes(image.begin(), image.end()), std::to_string(timeout)},
        [expected = *dimensions](OperationReply reply) {
          const auto actual = rotation_dimensions(reply.bytes);
          if (reply.kind != ReplyKind::Value || !actual ||
              actual->width != expected.height || actual->height != expected.width)
            return Result<Bytes>::failure({ErrorCode::HostFailure, "invalid rotated PNG"});
          return Result<Bytes>::success(std::move(reply.bytes));
        });
  }
 private:
  struct RotationDimensions { std::uint32_t width, height; };
  // Declared dimensions and PNG framing only: not CRC/decompression/pixel checks.
  static std::optional<RotationDimensions> rotation_dimensions(std::span<const std::uint8_t> bytes) {
    constexpr std::array<std::uint8_t, 8> signature{137, 80, 78, 71, 13, 10, 26, 10};
    if (bytes.size() < 57 || bytes.size() > 1048576) return std::nullopt;
    for (std::size_t i = 0; i < signature.size(); ++i)
      if (bytes[i] != signature[i]) return std::nullopt;
    const auto u32 = [&](std::size_t offset) {
      return (std::uint32_t(bytes[offset]) << 24) | (std::uint32_t(bytes[offset + 1]) << 16) |
          (std::uint32_t(bytes[offset + 2]) << 8) | std::uint32_t(bytes[offset + 3]);
    };
    RotationDimensions dimensions{};
    std::size_t offset = 8, chunks = 0;
    bool data = false, seen_data = false, ended_data = false, palette = false;
    while (offset < bytes.size()) {
      if (++chunks > 1024 || bytes.size() - offset < 12) return std::nullopt;
      const auto size = u32(offset);
      // Subtract before adding: size_t is 32-bit in the Wasm build.
      if (size > bytes.size() - offset - 12) return std::nullopt;
      const auto end = offset + size + 12;
      for (std::size_t i = 4; i < 8; ++i) {
        const auto c = bytes[offset + i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) return std::nullopt;
      }
      if (bytes[offset + 6] & 32) return std::nullopt;
      const std::string_view type(reinterpret_cast<const char*>(bytes.data() + offset + 4), 4);
      if (offset == 8) {
        if (type != "IHDR" || size != 13) return std::nullopt;
        dimensions = {u32(offset + 8), u32(offset + 12)};
        if (!dimensions.width || dimensions.width > 1024 || !dimensions.height || dimensions.height > 1024 ||
            bytes[offset + 16] != 8 || (bytes[offset + 17] != 2 && bytes[offset + 17] != 6) ||
            bytes[offset + 18] || bytes[offset + 19] || bytes[offset + 20] > 1) return std::nullopt;
      } else if (type == "IHDR" || type == "acTL" || type == "fcTL" || type == "fdAT") {
        return std::nullopt;
      } else if (type == "IDAT") {
        if (ended_data) return std::nullopt;
        seen_data = true;
        if (size) data = true;
      } else {
        if (seen_data) ended_data = true;
        if (type == "IEND") {
          if (size || !data || end != bytes.size()) return std::nullopt;
          return dimensions;
        }
        if (type == "PLTE") {
          if (seen_data || palette || !size || size > 768 || size % 3) return std::nullopt;
          palette = true;
        } else if (!(bytes[offset + 4] & 32)) return std::nullopt;
      }
      offset = end;
    }
    return std::nullopt;
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
