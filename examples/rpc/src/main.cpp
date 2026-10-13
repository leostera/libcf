#include "cf/rpc.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  RpcService service(context.bindings, path == "/missing" ? "MISSING" : "REFERENCE");
  std::string method;
  std::string arguments = "[]";
  if (path == "/echo" && request.method == "POST") { method = "echo"; arguments = std::move(request.body); }
  else if (path == "/sum") { method = "sum"; arguments = "[20,22]"; }
  else if (path == "/failure") method = "fail";
  else if (path == "/capability") method = "capability";
  else if (path == "/large") method = "large";
  else if (path == "/reserved") method = "fetch";
  else if (path == "/missing") method = "echo";
  else co_return Response::text("not found", 404);
  auto result = co_await service.call_json(std::move(method), std::move(arguments));
  co_return result ? Response::text(std::move(result.value())) : Response::text("RPC failed", 502);
}
}  // namespace cf
