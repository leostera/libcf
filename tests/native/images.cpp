#include <cassert>
#include "cf/images.hpp"
#include "cf/task.hpp"
// Framed mock PNGs: CRCs and compressed pixels are deliberately not decoded.
static void chunk(cf::Bytes& bytes, std::string_view type, const cf::Bytes& data) {
  const auto size = static_cast<std::uint32_t>(data.size());
  for (int shift : {24, 16, 8, 0}) bytes.push_back(static_cast<std::uint8_t>(size >> shift));
  bytes.insert(bytes.end(), type.begin(), type.end()); bytes.insert(bytes.end(), data.begin(), data.end());
  bytes.insert(bytes.end(), 4, 0);
}
static cf::Bytes framed(std::uint32_t width = 2, std::uint32_t height = 3, std::size_t padding = 0) {
  cf::Bytes bytes{137,80,78,71,13,10,26,10}, header;
  for (auto size : {width, height})
    for (int shift : {24,16,8,0}) header.push_back(static_cast<std::uint8_t>(size >> shift));
  header.insert(header.end(), {8,6,0,0,0}); chunk(bytes, "IHDR", header);
  if (padding) chunk(bytes, "teSt", cf::Bytes(padding));
  chunk(bytes, "IDAT", {0}); chunk(bytes, "IEND", {}); return bytes;
}
static void rotation() {
  using namespace cf;
  int calls = 0; bool fail = false; OperationCall observed{};
  OperationReply reply{ReplyKind::Value, framed(3,2)};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    if (fail) done(Result<OperationReply>::failure({ErrorCode::HostFailure, "provider failure"}));
    else done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Images client(runtime, "IMAGES");
  auto handler = [&]() -> Task {
    auto input = framed();
    auto result = co_await client.rotate_png90(input); assert(result && result.value() == reply.bytes);
    assert(observed.method == Operation::ImageRotatePng90 && observed.binding == "IMAGES" && observed.key.empty() && observed.options == "5000" && observed.body == input);
    ImageRotateOptions options{std::chrono::milliseconds(60000)};
    auto pending = client.rotate_png90(input, options);
    input.clear(); options.timeout = std::chrono::milliseconds(0); client = Images(runtime, "OTHER");
    assert(co_await pending); assert(observed.body == framed() && observed.options == "60000" && observed.binding == "IMAGES");
    reply.bytes = framed(3,2,1048576 - 58 - 12);
    result = co_await client.rotate_png90(framed()); assert(result && result.value().size() == 1048576);
    reply.bytes.clear(); assert(result.value().front() == 137);
    reply.bytes = framed(3,2);
    assert(co_await client.rotate_png90(framed(2,3,1048576 - 58 - 12), {std::chrono::milliseconds(1)}));
    assert(observed.body.size() == 1048576 && observed.options == "1");
    reply.bytes = framed(1024,1024); assert(co_await client.rotate_png90(framed(1024,1024)));
    const int baseline = calls;
    for (const auto& bad : std::vector<Bytes>{ {}, Bytes(1048577), framed(0,3), framed(1025,3) }) {
      auto invalid = co_await client.rotate_png90(bad); assert(!invalid && invalid.error().code == ErrorCode::InvalidInput);
    }
    for (auto offset : {0,24,25,26,27,28,33}) {
      auto bad = framed(); bad[static_cast<std::size_t>(offset)] = 255;
      assert(!(co_await client.rotate_png90(bad)));
    }
    auto trailing = framed(); trailing.push_back(0); assert(!(co_await client.rotate_png90(trailing)));
    auto truncated = framed(); truncated.pop_back(); assert(!(co_await client.rotate_png90(truncated)));
    auto animation = framed(); Bytes control; chunk(control, "acTL", {});
    animation.insert(animation.begin() + 33, control.begin(), control.end()); assert(!(co_await client.rotate_png90(animation)));
    auto many = framed(); Bytes extra; chunk(extra, "teSt", {});
    for (int i = 0; i < 1023; ++i) many.insert(many.begin() + 33, extra.begin(), extra.end());
    assert(!(co_await client.rotate_png90(many)));
    for (int timeout : {-1,0,60001}) assert(!(co_await client.rotate_png90(framed(), {std::chrono::milliseconds(timeout)})));
    assert(calls == baseline);
    for (const auto& bad : std::vector<Bytes>{ {}, Bytes(1048577), framed(2,3), truncated, trailing, animation, many }) {
      reply.bytes = bad; auto invalid = co_await client.rotate_png90(framed());
      assert(!invalid && invalid.error().code == ErrorCode::HostFailure);
    }
    reply.bytes = framed(3,2);
    for (auto kind : {ReplyKind::Missing, static_cast<ReplyKind>(99)}) {
      reply.kind = kind; auto invalid = co_await client.rotate_png90(framed()); assert(!invalid && invalid.error().code == ErrorCode::HostFailure);
    }
    reply.kind = ReplyKind::Value; fail = true;
    result = co_await client.rotate_png90(framed()); assert(!result && result.error().message == "provider failure");
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
int main() {
  rotation();
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
