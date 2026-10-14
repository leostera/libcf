#pragma once
#include <chrono>
#include <span>

#include "cf/detail/text.hpp"
#include "cf/operation.hpp"

namespace cf {
class Queue {
 public:
  Queue(BindingRuntime runtime, std::string binding) : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] AsyncResult<Unit> send_text(std::string text, std::chrono::seconds delay = {}) const {
    return send(Operation::QueueSendText, Bytes(text.begin(), text.end()), delay);
  }
  [[nodiscard]] AsyncResult<Unit> send_bytes(Bytes bytes, std::chrono::seconds delay = {}) const {
    return send(Operation::QueueSendBytes, std::move(bytes), delay);
  }
  // Snapshot the whole batch before suspension. The 256000-byte wire budget
  // includes framing; provider metadata can still reduce actual acceptance.
  [[nodiscard]] AsyncResult<Unit> send_text_batch(
      std::span<const std::string> messages, std::chrono::seconds delay = {}) const {
    const auto invalid = [] {
      return AsyncResult<Unit>([](auto done) {
        done(Result<Unit>::failure({ErrorCode::InvalidInput, "invalid Queue text batch"}));
      }, [](std::coroutine_handle<>) {});
    };
    if (messages.empty() || messages.size() > 100 || delay.count() < 0 || delay.count() > 86400)
      return invalid();
    std::size_t size = 4;
    for (const auto& message : messages) {
      if (!detail::bounded_utf8(message, 0, 127999) || message.find('\0') != std::string::npos ||
          size > 256000 - 4 ||
          message.size() > 256000 - size - 4) return invalid();
      size += 4 + message.size();
    }
    Bytes wire;
    wire.reserve(size);
    const auto u32 = [&](std::uint32_t value) {
      for (unsigned shift = 0; shift < 32; shift += 8)
        wire.push_back(static_cast<std::uint8_t>(value >> shift));
    };
    u32(static_cast<std::uint32_t>(messages.size()));
    for (const auto& message : messages) {
      u32(static_cast<std::uint32_t>(message.size()));
      wire.insert(wire.end(), message.begin(), message.end());
    }
    return send(Operation::QueueSendTextBatch, std::move(wire), delay);
  }

 private:
  AsyncResult<Unit> send(Operation method, Bytes bytes, std::chrono::seconds delay) const {
    // Queue limits use decimal KB; provider metadata may further reduce capacity.
    const auto maximum = method == Operation::QueueSendTextBatch ? 256000u : 127999u;
    if (bytes.size() > maximum || delay.count() < 0 || delay.count() > 86400) {
      return AsyncResult<Unit>([](auto done) {
        done(Result<Unit>::failure({ErrorCode::InvalidInput, "invalid Queue body size or delay"}));
      }, [](std::coroutine_handle<>) {});
    }
    return runtime_.call<Unit>({method, binding_, {}, std::move(bytes), std::to_string(delay.count())},
        [](OperationReply reply) {
          if (reply.kind != ReplyKind::Value || !reply.bytes.empty())
            return Result<Unit>::failure({ErrorCode::HostFailure, "invalid Queue acknowledgment"});
          return Result<Unit>::success({});
        });
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
