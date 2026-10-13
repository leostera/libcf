#pragma once
#include <chrono>
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
 private:
  AsyncResult<Unit> send(Operation method, Bytes bytes, std::chrono::seconds delay) const {
    if (bytes.size() >= 128 * 1024 || delay.count() < 0 || delay.count() > 86400) {
      return AsyncResult<Unit>([](auto done) {
        done(Result<Unit>::failure({ErrorCode::InvalidInput, "invalid Queue body size or delay"}));
      }, [](std::coroutine_handle<>) {});
    }
    return runtime_.call<Unit>({method, binding_, {}, std::move(bytes), std::to_string(delay.count())},
        [](OperationReply) { return Result<Unit>::success({}); });
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
