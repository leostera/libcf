#pragma once

#include "cf/operation.hpp"

namespace cf {
enum class RateLimitOutcome { Allowed, Exceeded };

class RateLimiter {
 public:
  RateLimiter(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  [[nodiscard]] AsyncResult<RateLimitOutcome> limit(std::string key) const {
    if (key.size() > 65536) {
      return AsyncResult<RateLimitOutcome>(
          [](auto done) {
            done(Result<RateLimitOutcome>::failure(
                {ErrorCode::InvalidInput, "rate limit key exceeds 64 KiB"}));
          },
          [](std::coroutine_handle<>) {});
    }
    return runtime_.call<RateLimitOutcome>(
        {Operation::RateLimit, binding_, std::move(key), {}, {}}, [](OperationReply reply) {
          if (reply.kind != ReplyKind::Value || reply.bytes.size() != 1 || reply.bytes[0] > 1)
            return Result<RateLimitOutcome>::failure(
                {ErrorCode::HostFailure, "invalid rate limit reply"});
          return Result<RateLimitOutcome>::success(reply.bytes[0] ? RateLimitOutcome::Allowed
                                                                  : RateLimitOutcome::Exceeded);
        });
  }

 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
