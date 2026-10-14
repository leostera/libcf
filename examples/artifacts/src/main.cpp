#include "cf/artifacts.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Artifacts metadata example; existing repositories only");
  if (request.method != "POST" || (path != "/info" && path != "/missing" && path != "/short-timeout"))
    co_return Response::text("not found", 404);
  Artifacts artifacts(context.bindings, path == "/missing" ? "MISSING" : "ARTIFACTS");
  ArtifactsInfoOptions options;
  if (path == "/short-timeout") options.timeout = std::chrono::milliseconds(5);
  const std::string_view name = request.body.empty() ? std::string_view("libcf-owned-repo") : std::string_view(request.body);
  auto result = co_await artifacts.info(name, options);
  if (!result) co_return Response::text("Artifacts metadata failed", 502);
  const auto& info = result.value();
  // Demonstration output is not delimiter-safe interchange or authorization.
  co_return Response::text(info.id + "\n" + info.name + "\n" + info.default_branch + "\n" + (info.read_only ? "read-only\n" : "writable\n"));
}
}  // namespace cf
