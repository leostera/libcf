#include "cf/ai_gateway.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("AI Gateway URL lookup; explicit mock fixture only");
  if (request.method != "POST" || (path != "/url" && path != "/universal" && path != "/explicit-universal" && path != "/provider-max" && path != "/missing" && path != "/short-timeout"))
    co_return Response::text("not found", 404);
  AiGateway gateway(context.bindings, path == "/missing" ? "MISSING" : "AI");
  AiGatewayUrlOptions options;
  if (path != "/universal") options.provider = "openai";
  if (path == "/explicit-universal") options.provider = "universal";
  if (path == "/provider-max") options.provider = std::string(64, 'p'); // Mock boundary only, not a real provider.
  if (path == "/short-timeout") options.timeout = std::chrono::milliseconds(5);
  const std::string_view id = request.body.empty() ? std::string_view("libcf-owned-gateway") : std::string_view(request.body);
  auto result = co_await gateway.lookup_url(id, options);
  if (!result) co_return Response::text("AI Gateway URL lookup failed", 502);
  // Endpoint metadata only. Never fetch, redirect, infer or attach credentials.
  co_return Response::text(result.value().url);
}
}  // namespace cf
