#include <cassert>
#include "cf/images.hpp"
#include "cf/task.hpp"
int main() {
  using namespace cf;
  int calls = 0;
  OperationReply reply{ReplyKind::Value, {0, 0, 0, 0}};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::ImageInfoGet && call.binding == "IMAGES" && call.key.empty() && call.options.empty());
    assert(call.body == Bytes({1}));
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Images images(runtime, "IMAGES");
  auto handler = [&]() -> Task {
    Bytes input{1};
    auto svg = co_await images.info(input);
    assert(svg && std::holds_alternative<SvgImageInfo>(svg.value()));
    reply.bytes = {1,0,0,0,70,0,0,0,2,0,0,0,3,0,0,0,9,0,0,0,'i','m','a','g','e','/','p','n','g'};
    auto raster = co_await images.info(input);
    assert(raster && std::holds_alternative<RasterImageInfo>(raster.value()));
    const auto& value = std::get<RasterImageInfo>(raster.value());
    assert(value.media_type == "image/png" && value.file_size == 70 && value.width == 2 && value.height == 3);
    reply.bytes[8] = 0;
    assert(!(co_await images.info(input)));
    reply.bytes = {0,0,0,0,1};
    assert(!(co_await images.info(input)));
    reply = {ReplyKind::Missing, {0,0,0,0}};
    assert(!(co_await images.info(input)));
    const auto baseline = calls;
    input.clear();
    assert(!(co_await images.info(input)));
    input.resize(1048577);
    assert(!(co_await images.info(std::move(input))));
    assert(calls == baseline);
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
