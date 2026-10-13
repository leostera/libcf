#include "cf/http_client.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  RedirectMode redirect = RedirectMode::Manual;
  std::string upstream_path;
  if (path == "/echo" || path == "/empty" || path == "/large" || path == "/failure")
    upstream_path = path;
  else if (path == "/manual" || path == "/follow" || path == "/error") {
    upstream_path = "/redirect";
    if (path == "/follow") redirect = RedirectMode::Follow;
    if (path == "/error") redirect = RedirectMode::Error;
  } else co_return Response::text("not found", 404);
  const auto base = context.env.var("UPSTREAM_URL");
  if (!base) co_return Response::text("upstream not configured", 502);
  Request outgoing;
  outgoing.method = request.method;
  outgoing.url = *base + upstream_path;
  outgoing.body = std::move(request.body);
  // Do not blindly proxy incoming Host, Cookie or Authorization headers.
  if (const auto value = request.headers.get("x-client")) outgoing.headers.append("x-client", std::string(*value));
  HttpClient client(context.bindings);
  auto result = co_await client.fetch(std::move(outgoing), redirect);
  if (!result) co_return Response::text("upstream failed", 502);
  co_return std::move(result.value());
}
}  // namespace cf
