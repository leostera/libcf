#include "cf/service.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  const bool missing = request.path() == "/missing-binding";
  ServiceBinding service(context.bindings, missing ? "NOT_CONFIGURED" : "UPSTREAM");
  request.url = "https://upstream.example.test" + std::string(request.path());
  request.headers.append("x-cf-caller", "cpp");
  auto result = co_await service.fetch(std::move(request));
  if (!result) co_return Response::text("service call failed", 502);
  co_return std::move(result.value());
}
}  // namespace cf
