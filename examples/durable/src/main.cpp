#include "cf/durable_object.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (path == "/missing-binding") {
    DurableObjectNamespace missing(context.bindings, "ABSENT");
    auto response = co_await missing.getByName("probe").fetch(std::move(request));
    co_return response ? std::move(response.value()) : Response::text("object binding failed", 502);
  }
  if (!path.starts_with("/objects/")) co_return Response::text("not found", 404);
  const auto rest = path.substr(9);
  const auto slash = rest.find('/');
  if (slash == std::string_view::npos) co_return Response::text("missing object action", 400);
  const std::string name(rest.substr(0, slash));
  request.url = "https://object.example.test/" + std::string(rest.substr(slash + 1));
  DurableObjectNamespace objects(context.bindings, "COUNTERS");
  auto response = co_await objects.getByName(name).fetch(std::move(request));
  co_return response ? std::move(response.value()) : Response::text("object call failed", 502);
}
}  // namespace cf
