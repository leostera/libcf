#pragma once
#include <chrono>
#include <optional>
#include "cf/detail/text.hpp"
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
struct ContainerLabel { std::string name; std::string value; };
struct ContainerInfo { std::string image; std::vector<ContainerLabel> labels; };
struct ContainerInspectOptions { std::chrono::milliseconds timeout{5000}; };

// Uses only the current DO's borrowed capability. No start/stop/exec methods.
class Container {
 public:
  explicit Container(BindingRuntime runtime) : runtime_(std::move(runtime)) {}
  // Null means no running info, not DO/application/data deletion. Inspection
  // activity may extend idle retention; timeout does not bound native work/cost.
  [[nodiscard]] AsyncResult<std::optional<ContainerInfo>> inspect(const ContainerInspectOptions& options = {}) const {
    const auto timeout = options.timeout.count();
    if (timeout < 1 || timeout > 60000)
      return AsyncResult<std::optional<ContainerInfo>>([](auto complete) {
        complete(Result<std::optional<ContainerInfo>>::failure({ErrorCode::InvalidInput, "invalid Container inspection request"}));
      }, [](std::coroutine_handle<>) {});
    return runtime_.call<std::optional<ContainerInfo>>(
        {Operation::ContainerInspect, "__LIBCF_DO_CONTAINER", {}, {}, std::to_string(timeout)}, decode);
  }
 private:
  static bool label_text(std::string_view text, std::size_t minimum, std::size_t maximum) {
    if (!detail::bounded_utf8(text, minimum, maximum)) return false;
    for (std::size_t i = 0; i < text.size(); ++i) {
      const auto byte = static_cast<unsigned char>(text[i]);
      if (byte < 0x20 || byte == 0x7f) return false;
      // Valid UTF-8 above lets us recognize the two-byte C1 control range.
      if (byte == 0xc2 && i + 1 < text.size()) {
        const auto next = static_cast<unsigned char>(text[i + 1]);
        if (next >= 0x80 && next <= 0x9f) return false;
      }
    }
    return true;
  }
  static Result<std::optional<ContainerInfo>> decode(OperationReply reply) {
    const auto invalid = [] { return Result<std::optional<ContainerInfo>>::failure(
        {ErrorCode::HostFailure, "invalid Container inspection reply"}); };
    if (reply.kind != ReplyKind::Value || reply.bytes.size() > 2940) return invalid();
    detail::WireReader wire(reply.bytes);
    std::uint32_t present = 0, count = 0;
    if (!wire.u32(present) || present > 1) return invalid();
    if (!present) {
      if (!wire.done()) return invalid();
      return Result<std::optional<ContainerInfo>>::success(std::nullopt);
    }
    ContainerInfo info;
    if (!wire.string(info.image) || !detail::bounded_utf8(info.image, 0, 2048) || !wire.u32(count) || count > 10) return invalid();
    info.labels.reserve(count);
    for (std::uint32_t i = 0; i < count; ++i) {
      ContainerLabel label;
      if (!wire.string(label.name) || !label_text(label.name, 1, 16) ||
          !wire.string(label.value) || !label_text(label.value, 0, 64)) return invalid();
      for (const auto& previous : info.labels) if (previous.name == label.name) return invalid();
      info.labels.push_back(std::move(label));
    }
    if (!wire.done()) return invalid();
    return Result<std::optional<ContainerInfo>>::success(std::move(info));
  }
  BindingRuntime runtime_;
};
}  // namespace cf
