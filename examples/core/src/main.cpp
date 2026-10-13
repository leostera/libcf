#include <charconv>
#include <optional>
#include <string>

#include "libcf/router.hpp"
#include "libcf/worker.hpp"

namespace libcf {

Task handle(Request request, WorkerContext context) {
  if (request.path() == "/asset") {
    auto result = co_await context.assets.get("/hello.txt");
    if (!result) co_return Response::text("fetch failed", 502);
    co_return Response::text("C++[" + result.value().body + "]", result.value().status);
  }

  Router router;
  router.route("GET", "/hello/:name", [](const auto&, const auto& params) {
    return Response::text("Hello, " + std::string(params.get("name")) + "!");
  });
  router.route("POST", "/echo", [](const auto& req, const auto&) {
    auto response = Response::text(req.body);
    response.headers.append("x-libcf", "cpp");
    return response;
  });
  router.route("GET", "/header", [](const auto& req, const auto&) {
    return Response::text(std::string(req.headers.get("x-greeting").value_or("absent")));
  });
  router.route("POST", "/background/:key", [&context](const auto& req, const auto& params) {
    context.execution.wait_until(BackgroundWork::kv_put("STATE_KV",
                                                        std::string(params.get("key")), req.body));
    return Response::text("queued", 202);
  });
  router.route("GET", "/stream/:count", [](const auto&, const auto& params) {
    const auto text = params.get("count");
    unsigned count = 0;
    const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), count);
    if (error != std::errc{} || end != text.data() + text.size() || count > 128)
      return Response::text("invalid count", 400);
    return Response::streaming([index = 0U, count]() mutable -> std::optional<std::string> {
      if (index >= count) return std::nullopt;
      return "chunk-" + std::to_string(index++) + "\n";
    });
  });
  router.route("GET", "/uuid", [&context](const auto&, const auto&) {
    return Response::text(context.crypto.random_uuid());
  });
  router.route("GET", "/env/:name", [&context](const auto&, const auto& params) {
    auto value = context.env.var(params.get("name"));
    return value ? Response::text(*value) : Response::text("binding missing", 404);
  });
  co_return router.dispatch(request);
}

}  // namespace libcf
