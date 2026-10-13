#include "cf/timer.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  using namespace std::chrono_literals;
  Timer timer(context.bindings);
  auto delay = 5ms;
  if (request.path() == "/zero") delay = 0ms;
  else if (request.path() == "/negative") delay = -1ms;
  else if (request.path() == "/oversized") delay = 60001ms;
  else if (request.path() != "/sleep") co_return Response::text("not found", 404);
  auto result = co_await timer.sleep(delay);
  if (!result) co_return Response::text("sleep failed", 400);
  co_return Response::text(request.url);
}
}  // namespace cf
