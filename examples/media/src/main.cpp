#include "cf/media.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Media frame example; POST video bytes to /frame");
  if (request.method != "POST" || (path != "/frame" && path != "/missing" &&
      path != "/oversized" && path != "/invalid-size" && path != "/short-timeout"))
    co_return Response::text("not found", 404);
  Media media(context.bindings, path == "/missing" ? "MISSING" : "MEDIA");
  MediaFrameRequest input{Bytes(request.body.begin(), request.body.end())};
  if (path == "/oversized") input.video.resize(1048577);
  if (path == "/invalid-size") input.width = 513;
  if (path == "/short-timeout") input.timeout = std::chrono::milliseconds(5);
  auto result = co_await media.frame_png(std::move(input));
  if (!result) co_return Response::text("Media frame failed", 502);
  Response response;
  response.headers.append("content-type", "image/png");
  response.body = std::string(result.value().begin(), result.value().end());
  co_return response;
}
}  // namespace cf
