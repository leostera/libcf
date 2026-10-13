#include <string>

#include "cf/cache.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (!path.starts_with("/entries/")) co_return Response::text("not found", 404);
  Cache cache(context.bindings, std::string(request.headers.get("x-cache-name").value_or("")));
  const auto url = "https://cache.example.test" + std::string(path);
  if (request.method == "PUT") {
    CachedResponse response;
    response.body = Bytes(request.body.begin(), request.body.end());
    response.headers.append("cache-control", "public, max-age=300");
    response.headers.append("content-type", "application/octet-stream");
    response.headers.append("x-origin", "cf");
    auto stored = co_await cache.put(url, std::move(response));
    co_return stored ? Response::text("cached", 201) : Response::text("cache put failed", 502);
  }
  if (request.method == "DELETE") {
    auto erased = co_await cache.erase(url);
    if (!erased) co_return Response::text("cache delete failed", 502);
    co_return Response::text(erased.value() ? "deleted" : "absent");
  }
  if (request.method == "GET") {
    auto result = co_await cache.match(url);
    if (!result) co_return Response::text("cache lookup failed", 502);
    if (!result.value()) co_return Response::text("cache miss", 404);
    auto& cached = *result.value();
    Response response;
    response.status = cached.status;
    response.headers = std::move(cached.headers);
    response.body = std::string(cached.body.begin(), cached.body.end());
    co_return response;
  }
  co_return Response::text("method not allowed", 405);
}
}  // namespace cf
