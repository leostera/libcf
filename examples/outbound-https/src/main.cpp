#include "cf/outbound_http.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Outbound HTTPS GET example; explicit mock providers only");
  if (request.method != "POST" || (path != "/mtls" && path != "/vpc-service" && path != "/vpc-network")) co_return Response::text("not found", 404);
  const std::string_view endpoint = request.body.empty() ? std::string_view("health") : std::string_view(request.body);
  BoundHttpsGetOptions options;
  if (endpoint.starts_with("slow-")) options.timeout = std::chrono::milliseconds(5);
  auto result = co_await (path == "/mtls" ? MtlsHttp(context.bindings, "CERT").get_bytes(endpoint, options) :
      path == "/vpc-service" ? VpcServiceHttp(context.bindings, "SERVICE").get_bytes(endpoint, options) :
      VpcNetworkHttp(context.bindings, "NETWORK").get_bytes(endpoint, options));
  if (!result) co_return Response::text("Outbound HTTPS GET failed", 502);
  Response response;
  response.headers.append("content-type", "application/octet-stream");
  response.headers.append("x-content-type-options", "nosniff");
  response.body = std::string(result.value().begin(), result.value().end());
  co_return response;
}
}  // namespace cf
