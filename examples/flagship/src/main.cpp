#include "cf/flagship.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Flagship boolean details example");
  if (request.method != "POST" || (path != "/evaluate" && path != "/missing" && path != "/short-timeout"))
    co_return Response::text("not found", 404);
  Flagship flags(context.bindings, path == "/missing" ? "MISSING" : "FLAGS");
  FlagshipBooleanOptions options;
  if (!request.body.empty()) options.targeting_key = std::move(request.body);
  if (path == "/short-timeout") options.timeout = std::chrono::milliseconds(5);
  auto result = co_await flags.boolean_details("libcf-owned-flag", true, options);
  if (!result) co_return Response::text("Flagship evaluation failed", 502);
  const auto& details = result.value();
  std::string output = details.value ? "true\n" : "false\n";
  for (const auto* field : {&details.variant, &details.reason, &details.error_code, &details.error_message})
    output += *field ? "value:" + **field + "\n" : "absent\n";
  // Human-readable demonstration, not delimiter-safe interchange or authorization.
  co_return Response::text(std::move(output));
}
}  // namespace cf
