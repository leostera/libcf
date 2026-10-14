#include "cf/container.hpp"
#include "cf/durable_object.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto event = context.env.var("__LIBCF_DO_EVENT");
  if (event == "initialize") co_return Response::text("initialized");
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Container inspection example; no lifecycle mutations");
  if (request.method != "GET" || (path != "/success" && path != "/none" && path != "/starting" && path != "/maximum" &&
      path != "/bad" && path != "/short-timeout" && path != "/invalid-timeout" && path != "/cleanup-fail"))
    co_return Response::text("not found", 404);
  if (!event) {
    DurableObjectNamespace objects(context.bindings, "OBJECTS");
    auto response = co_await objects.getByName("libcf-inspect" + std::string(path)).fetch(std::move(request));
    if (!response) co_return Response::text("Container request failed", 502);
    co_return std::move(response.value());
  }
  Container container(context.bindings);
  ContainerInspectOptions options;
  if (path == "/short-timeout") options.timeout = std::chrono::milliseconds(5);
  if (path == "/invalid-timeout") options.timeout = std::chrono::milliseconds(0);
  auto result = co_await container.inspect(options);
  if (!result) co_return Response::text("Container inspection failed", 502);
  if (!result.value()) co_return Response::text("no running container info");
  const auto& info = *result.value();
  std::string output = "image=" + info.image + "\nlabels=" + std::to_string(info.labels.size()) + "\n";
  for (const auto& label : info.labels) output += label.name + "\t" + label.value + "\n";
  // A human-readable demonstration, not delimiter-safe interchange.
  co_return Response::text(std::move(output));
}
}  // namespace cf
