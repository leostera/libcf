#include "cf/ai.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.method == "GET" && request.path() == "/")
    co_return Response::text("AI JSON example; inference requires an explicit POST");
  if (request.method != "POST" || request.path() != "/run")
    co_return Response::text("not found", 404);
  Ai ai(context.bindings, "AI");
  AiRequest input{.model = "@cf/meta/llama-3.2-1b-instruct", .input_json = std::move(request.body)};
  auto result = co_await ai.run_json(std::move(input));
  if (!result) co_return Response::text("AI request failed", 502);
  Response response;
  response.headers.append("content-type", "application/json");
  response.body = std::move(result.value());
  co_return response;
}
}  // namespace cf
