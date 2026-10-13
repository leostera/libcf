#include <array>
#include "cf/workflow.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  const auto separator = path.find('/', 1);
  if (separator == std::string_view::npos) co_return Response::text("not found", 404);
  const auto action = path.substr(1, separator - 1);
  const std::string id(path.substr(separator + 1));
  Workflow workflow(context.bindings, action == "missing" ? "MISSING" : "FLOW");
  if ((action == "create" || action == "missing") && request.method == "POST") {
    auto result = co_await workflow.create(id, std::move(request.body));
    co_return Response::text(result ? "created" : "create failed", result ? 201 : 502);
  }
  if (action == "event" && request.method == "POST") {
    auto result = co_await workflow.send_event_json(id, "continue", std::move(request.body));
    co_return Response::text(result ? "event sent" : "event failed", result ? 202 : 502);
  }
  if (action == "state" && request.method == "GET") {
    auto result = co_await workflow.state(id);
    if (!result) co_return Response::text("state failed", 502);
    constexpr std::array names{"queued", "running", "paused", "errored", "terminated", "complete", "waiting", "waitingForPause", "rollingBack", "unknown"};
    co_return Response::text(names[static_cast<unsigned>(result.value())]);
  }
  if (action == "delete" && request.method == "DELETE") {
    auto result = co_await workflow.erase(id);
    co_return Response::text(result ? "deleted" : "delete failed", result ? 200 : 502);
  }
  co_return Response::text("not found", 404);
}
}  // namespace cf
