#include "cf/pipeline.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.method != "POST" || (request.path() != "/send" && request.path() != "/missing" && request.path() != "/oversized"))
    co_return Response::text("not found", 404);
  if (request.path() == "/oversized") request.body.assign(1048577, ' ');
  Pipeline pipeline(context.bindings, request.path() == "/missing" ? "MISSING" : "EVENTS");
  auto result = co_await pipeline.send_json(std::move(request.body));
  if (!result) co_return Response::text("pipeline send failed", 502);
  co_return Response::text("send completed; sink not verified", 202);
}
}  // namespace cf
