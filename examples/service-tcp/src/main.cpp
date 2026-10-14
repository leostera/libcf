#include "cf/service_tcp.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.method == "GET" && request.path() == "/")
    co_return Response::text("bounded service TCP example");
  if (request.method != "POST") co_return Response::text("not found", 404);
  ServiceTcpRequest input{.hostname = "echo.invalid", .port = 1234,
    .body = Bytes(request.body.begin(), request.body.end())};
  if (request.path() == "/bad-address") input.hostname = "bad\n";
  else if (request.path() == "/overflow") input.response_limit = 1;
  else if (request.path() == "/timeout") {
    input.hostname = "slow.invalid";
    input.timeout = std::chrono::milliseconds(20);
  } else if (request.path() != "/echo") co_return Response::text("not found", 404);
  ServiceTcp service(context.bindings, "BACKEND");
  auto result = co_await service.exchange(std::move(input));
  if (!result) co_return Response::text("service TCP exchange failed", 502);
  Response response;
  response.headers.append("content-type", "application/octet-stream");
  response.body = std::string(result.value().begin(), result.value().end());
  co_return response;
}
}  // namespace cf
