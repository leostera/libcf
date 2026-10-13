#include "cf/images.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method != "POST" || (path != "/info" && path != "/missing" && path != "/oversized"))
    co_return Response::text("not found", 404);
  Images images(context.bindings, path == "/missing" ? "MISSING" : "IMAGES");
  Bytes input(request.body.begin(), request.body.end());
  if (path == "/oversized") input.resize(1048577);
  auto result = co_await images.info(std::move(input));
  if (!result) co_return Response::text("image info failed", 502);
  if (std::holds_alternative<SvgImageInfo>(result.value())) co_return Response::text("image/svg+xml");
  const auto& info = std::get<RasterImageInfo>(result.value());
  co_return Response::text(info.media_type + " " + std::to_string(info.width) + "x" +
      std::to_string(info.height) + " " + std::to_string(info.file_size));
}
}  // namespace cf
