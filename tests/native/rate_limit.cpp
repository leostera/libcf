#include "cf/rate_limit.hpp"

#include <cassert>

#include "cf/task.hpp"

int main() {
  using namespace cf;
  int calls = 0;
  BindingRuntime runtime(
      [&](OperationCall call, BindingRuntime::Completion done) {
        ++calls;
        assert(call.method == Operation::RateLimit && call.binding == "LIMITER");
        const auto value = call.key == "deny" ? 0 : call.key == "bad" ? 2 : 1;
        done(Result<OperationReply>::success(
            {call.key == "missing" ? ReplyKind::Missing : ReplyKind::Value,
             Bytes{static_cast<std::uint8_t>(value)}}));
      },
      [](auto) {});
  RateLimiter limiter(runtime, "LIMITER");
  auto handler = [&]() -> Task {
    auto allowed = co_await limiter.limit("");
    assert(allowed && allowed.value() == RateLimitOutcome::Allowed);
    auto denied = co_await limiter.limit("deny");
    assert(denied && denied.value() == RateLimitOutcome::Exceeded);
    auto bad = co_await limiter.limit("bad");
    assert(!bad && bad.error().code == ErrorCode::HostFailure);
    auto missing = co_await limiter.limit("missing");
    assert(!missing);
    auto oversized = co_await limiter.limit(std::string(65537, 'x'));
    assert(!oversized && oversized.error().code == ErrorCode::InvalidInput);
    co_return Response{};
  };
  auto task = handler().take();
  task.resume();
  assert(task.done() && calls == 4);
  task.destroy();
}
