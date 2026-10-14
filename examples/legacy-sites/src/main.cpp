#include "cf/sites.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Legacy Sites read-only example; POST logical key to /read");
  if (request.method != "POST" || (path != "/read" && path != "/missing-binding")) co_return Response::text("not found", 404);
  LegacySites sites(context.bindings, path == "/missing-binding" ? "MISSING" : "__STATIC_CONTENT");
  const std::string_view key = request.body.empty() ? std::string_view("index.txt") : std::string_view(request.body);
  auto result = co_await sites.get_bytes(key);
  if (!result) co_return Response::text("Sites read failed", 502);
  if (!result.value()) co_return Response::text("not found", 404);
  Response response;
  response.headers.append("content-type", "application/octet-stream");
  response.headers.append("x-content-type-options", "nosniff");
  response.body = std::string(result.value()->begin(), result.value()->end());
  co_return response;
}
}  // namespace cf
