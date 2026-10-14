#include "cf/stream_video.hpp"
#include "cf/worker.hpp"

namespace cf {
static std::string show(const StreamVideoInfo& video) {
  return video.id + "\t" + video.state + "\t" + (video.ready_to_stream ? "true" : "false") + "\t" +
      std::to_string(video.size_bytes) + "\t" + (video.duration ? std::to_string(video.duration->count()) : "unknown") + "\n";
}
Task handle(Request request, WorkerContext context) {
  if (request.method == "GET" && request.path() == "/")
    co_return Response::text("bounded Stream metadata example");
  StreamVideoLibrary videos(context.bindings, "STREAM");
  if (request.method == "GET" && request.path() == "/videos") {
    auto result = co_await videos.list();
    if (!result) co_return Response::text("Stream metadata failed", 502);
    std::string text;
    for (const auto& video : result.value()) text += show(video);
    co_return Response::text(std::move(text));
  }
  if (request.method == "POST" && (request.path() == "/details" || request.path() == "/short-timeout")) {
    StreamVideoDetailsRequest input{std::move(request.body)};
    if (request.path() == "/short-timeout") input.timeout = std::chrono::milliseconds(20);
    auto result = co_await videos.details(input);
    if (!result) co_return Response::text("Stream metadata failed", 502);
    co_return Response::text(show(result.value()));
  }
  co_return Response::text("not found", 404);
}
}  // namespace cf
