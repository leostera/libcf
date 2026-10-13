#include "cf/rate_limit.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.method != "POST") co_return Response::text("not found", 404);
  const auto path = request.path();
  if (path != "/limit" && path != "/other" && path != "/missing") co_return Response::text("not found", 404);
  const auto binding = path == "/missing" ? "MISSING" : path == "/other" ? "OTHER" : "LIMITER";
  RateLimiter limiter(context.bindings, binding);
  auto outcome = co_await limiter.limit(std::move(request.body));
  if (!outcome) co_return Response::text("limiter failed", 502);
  co_return outcome.value() == RateLimitOutcome::Allowed ? Response::text("allowed") : Response::text("exceeded", 429);
}
}  // namespace cf
