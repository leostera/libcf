#pragma once
#include <chrono>
#include "cf/operation.hpp"

namespace cf {
class Timer {
 public:
  explicit Timer(BindingRuntime runtime) : runtime_(std::move(runtime)) {}
  [[nodiscard]] AsyncResult<Unit> sleep(std::chrono::milliseconds delay) const {
    const auto count = delay.count();
    if (count < 0 || count > 60000)
      return AsyncResult<Unit>([](auto complete) {
        complete(Result<Unit>::failure({ErrorCode::InvalidInput, "sleep requires 0..60000 milliseconds"}));
      }, [](std::coroutine_handle<>) {});
    const auto milliseconds = static_cast<std::uint32_t>(count);
    Bytes body;
    for (unsigned shift = 0; shift < 32; shift += 8)
      body.push_back(static_cast<std::uint8_t>(milliseconds >> shift));
    return runtime_.call<Unit>({Operation::Sleep, {}, {}, std::move(body), {}}, [](OperationReply reply) {
      if (reply.kind != ReplyKind::Value || !reply.bytes.empty())
        return Result<Unit>::failure({ErrorCode::HostFailure, "invalid sleep completion"});
      return Result<Unit>::success({});
    });
  }
 private:
  BindingRuntime runtime_;
};
}  // namespace cf
