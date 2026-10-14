#include <cassert>
#include "cf/media.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  int calls = 0;
  const Bytes png{137, 80, 78, 71, 13, 10, 26, 10};
  OperationReply reply{ReplyKind::Value, png};
  Bytes expected_body{0, 128, 255};
  std::string expected_options = "128:128:5000";
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::MediaFramePng && call.binding == "MEDIA" && call.key.empty());
    assert(call.body == expected_body && call.options == expected_options);
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Media media(runtime, "MEDIA");
  auto handler = [&]() -> Task {
    MediaFrameRequest request{expected_body};
    auto result = co_await media.frame_png(request);
    assert(result && result.value() == png);
    result.value()[0] = 0;
    assert(reply.bytes == png);
    for (const auto kind : {ReplyKind::Missing, ReplyKind::Value}) {
      reply.kind = kind;
      reply.bytes = kind == ReplyKind::Missing ? png : Bytes{1};
      assert(!(co_await media.frame_png(request)));
    }
    reply.bytes = Bytes(8, 0);
    assert(!(co_await media.frame_png(request)));
    reply.bytes = png;
    reply.bytes.resize(1048577);
    assert(!(co_await media.frame_png(request)));
    reply.bytes = png;
    const auto baseline = calls;
    request.video.clear();
    assert(!(co_await media.frame_png(request)));
    request.video.resize(1048577);
    assert(!(co_await media.frame_png(request)));
    request.video = expected_body;
    for (const auto size : {0u, 9u, 513u, 0xffffffffu}) {
      request.width = size;
      assert(!(co_await media.frame_png(request)));
      request.width = 128;
      request.height = size;
      assert(!(co_await media.frame_png(request)));
      request.height = 128;
    }
    for (const auto duration : {-1, 0, 60001}) {
      request.timeout = std::chrono::milliseconds(duration);
      assert(!(co_await media.frame_png(request)));
    }
    assert(calls == baseline);
    request = MediaFrameRequest{Bytes(1048576, 7), 10, 512, std::chrono::milliseconds(60000)};
    expected_body = request.video;
    expected_options = "10:512:60000";
    assert(co_await media.frame_png(std::move(request)));
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
