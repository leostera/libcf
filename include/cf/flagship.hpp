#pragma once
#include <chrono>
#include <optional>
#include "cf/detail/text.hpp"
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
struct FlagshipBooleanOptions {
  std::optional<std::string> targeting_key;
  std::chrono::milliseconds timeout{5000};
};
struct FlagshipBooleanDetails {
  bool value = false;
  std::optional<std::string> variant;
  std::optional<std::string> reason;
  std::optional<std::string> error_code;
  std::optional<std::string> error_message;
};

class Flagship {
 public:
  Flagship(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  // A successful bridge result can contain a provider fallback. Inspect details;
  // transport errors never manufacture a fallback. Timeout does not stop native work.
  [[nodiscard]] AsyncResult<FlagshipBooleanDetails> boolean_details(
      std::string_view key, bool fallback, const FlagshipBooleanOptions& options = {}) const {
    const auto timeout = options.timeout.count();
    if (!identifier(key, 128) || timeout < 1 || timeout > 60000 ||
        (options.targeting_key && !identifier(*options.targeting_key, 256)))
      return AsyncResult<FlagshipBooleanDetails>([](auto complete) {
        complete(Result<FlagshipBooleanDetails>::failure({ErrorCode::InvalidInput, "invalid Flagship request"}));
      }, [](std::coroutine_handle<>) {});
    // Validate borrowed views/options before making bounded owned snapshots.
    Bytes context;
    if (options.targeting_key) context.assign(options.targeting_key->begin(), options.targeting_key->end());
    return runtime_.call<FlagshipBooleanDetails>(
        {Operation::FlagshipBooleanDetails, binding_, std::string(key), std::move(context),
         std::string(fallback ? "1:" : "0:") + std::to_string(timeout)}, decode);
  }
 private:
  static bool identifier(std::string_view value, std::size_t maximum) {
    if (!detail::bounded_utf8(value, 1, maximum)) return false;
    for (std::size_t i = 0; i < value.size(); ++i) {
      const auto byte = static_cast<unsigned char>(value[i]);
      if (byte < 0x20 || byte == 0x7f) return false;
      if (byte == 0xc2 && i + 1 < value.size()) {
        const auto next = static_cast<unsigned char>(value[i + 1]);
        if (next >= 0x80 && next <= 0x9f) return false;
      }
    }
    return true;
  }
  static bool optional_text(detail::WireReader& wire, std::optional<std::string>& value, std::size_t maximum) {
    std::uint32_t present = 0;
    if (!wire.u32(present) || present > 1) return false;
    if (!present) { value.reset(); return true; }
    std::string text;
    if (!wire.string(text) || !detail::bounded_utf8(text, 0, maximum)) return false;
    value = std::move(text);
    return true;
  }
  static Result<FlagshipBooleanDetails> decode(OperationReply reply) {
    const auto invalid = [] { return Result<FlagshipBooleanDetails>::failure(
        {ErrorCode::HostFailure, "invalid Flagship details reply"}); };
    if (reply.kind != ReplyKind::Value || reply.bytes.size() < 20 || reply.bytes.size() > 4516) return invalid();
    detail::WireReader wire(reply.bytes);
    FlagshipBooleanDetails details;
    std::uint32_t selected = 0;
    if (!wire.u32(selected) || selected > 1 ||
        !optional_text(wire, details.variant, 256) || !optional_text(wire, details.reason, 64) ||
        !optional_text(wire, details.error_code, 64) || !optional_text(wire, details.error_message, 4096) ||
        !wire.done()) return invalid();
    details.value = selected == 1;
    return Result<FlagshipBooleanDetails>::success(std::move(details));
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
