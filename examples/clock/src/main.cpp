#include "cf/clock.hpp"
#include "cf/timer.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (path != "/now" && path != "/same-turn" && path != "/after-sleep")
    co_return Response::text("not found", 404);
  auto first = context.clock.now();
  if (!first) co_return Response::text("clock failed", 502);
  const auto count = first.value().time_since_epoch().count();
  if (path == "/same-turn") {
    // Report every sample; the host decides whether time freezes without I/O.
    auto samples = std::to_string(count);
    for (int index = 0; index < 32; ++index) {
      auto next = context.clock.now();
      if (!next) co_return Response::text("clock failed", 502);
      samples += " " + std::to_string(next.value().time_since_epoch().count());
    }
    co_return Response::text(std::move(samples));
  }
  if (path == "/after-sleep") {
    Timer timer(context.bindings);
    auto slept = co_await timer.sleep(std::chrono::milliseconds{5});
    if (!slept) co_return Response::text("sleep failed", 502);
    auto next = context.clock.now();
    if (!next) co_return Response::text("clock failed", 502);
    co_return Response::text(std::to_string(count) + " " + std::to_string(next.value().time_since_epoch().count()));
  }
  co_return Response::text(std::to_string(count));
}
}  // namespace cf
