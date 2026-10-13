#include "cf/metadata.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.path() == "/version" || request.path() == "/missing-version") {
    VersionMetadata binding(context.bindings, request.path() == "/version" ? "VERSION" : "MISSING");
    auto version = co_await binding.get();
    if (!version) co_return Response::text("metadata unavailable", 502);
    auto response = Response::text(version.value().id);
    response.headers.append("x-version-tag", version.value().tag);
    response.headers.append("x-version-timestamp", version.value().timestamp);
    co_return response;
  }
  if (request.method == "POST" && (request.path() == "/secret-check" || request.path() == "/missing-secret")) {
    SecretsStoreSecret binding(context.bindings, request.path() == "/secret-check" ? "SECRET" : "MISSING");
    auto secret = co_await binding.get();
    if (!secret) co_return Response::text("secret unavailable", 502);
    // Diagnostic comparison of a synthetic fixture value, not an authentication
    // endpoint or a constant-time secret-comparison API. Never echo the value.
    auto response = secret.value() == request.body ? Response::text("match") : Response::text("mismatch", 409);
    response.headers.append("cache-control", "no-store");
    co_return response;
  }
  co_return Response::text("not found", 404);
}
}  // namespace cf
