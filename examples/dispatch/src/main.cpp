#include "cf/dispatch.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.method == "GET" && request.path() == "/")
    co_return Response::text("bounded dispatch example");
  DispatchTarget target{"example"};
  if (request.path() == "/missing") target.worker = "missing";
  else if (request.path() == "/invalid") target.worker = "bad\n";
  else if (request.path() != "/echo" && request.path() != "/redirect" && request.path() != "/overflow" && request.path() != "/max-reply")
    co_return Response::text("not found", 404);
  DispatchNamespace dispatch(context.bindings, "DISPATCHER");
  auto result = co_await dispatch.fetch(std::move(target), std::move(request));
  if (!result) co_return Response::text("dispatch failed", 502);
  co_return std::move(result.value());
}
}  // namespace cf
