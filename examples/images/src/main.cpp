#include "cf/images.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "POST" && (path == "/rotate" || path == "/rotate-missing" || path == "/rotate-oversized")) {
    Images images(context.bindings, path == "/rotate-missing" ? "MISSING" : "IMAGES");
    Bytes input(request.body.begin(), request.body.end());
    if (path == "/rotate-oversized") input.resize(1048577);
    auto result = co_await images.rotate_png90(input);
    if (!result) co_return Response::text("image rotation failed", 502);
    Response response;
    response.headers.append("content-type", "image/png");
    response.headers.append("x-content-type-options", "nosniff");
    const auto& bytes = result.value();
    response.body = std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
    co_return response;
  }
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
