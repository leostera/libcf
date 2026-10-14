#include "cf/browser.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Browser example; POST UTF-8 HTML to /screenshot");
  if (request.method != "POST" || (path != "/screenshot" && path != "/missing" &&
      path != "/invalid-size" && path != "/short-timeout"))
    co_return Response::text("not found", 404);
  BrowserRun browser(context.bindings, path == "/missing" ? "MISSING" : "BROWSER");
  BrowserScreenshotRequest input{std::move(request.body)};
  if (path == "/invalid-size") input.width = 513;
  if (path == "/short-timeout") input.timeout = std::chrono::milliseconds(5);
  auto result = co_await browser.screenshot_html_png(input);
  if (!result) co_return Response::text("Browser screenshot failed", 502);
  Response response;
  response.headers.append("content-type", "image/png");
  response.body = std::string(result.value().begin(), result.value().end());
  co_return response;
}
}  // namespace cf
