#include <cassert>
#include "cf/stream_video.hpp"
#include "cf/task.hpp"

static void u32(cf::Bytes& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
static void u64(cf::Bytes& bytes, std::uint64_t value) { u32(bytes, static_cast<std::uint32_t>(value)); u32(bytes, static_cast<std::uint32_t>(value >> 32)); }
static void string(cf::Bytes& bytes, const std::string& text) {
  u32(bytes, static_cast<std::uint32_t>(text.size())); bytes.insert(bytes.end(), text.begin(), text.end());
}
static cf::Bytes reply_bytes(std::string id = "owned-id", std::string state = "ready", std::uint32_t ready = 1,
                             std::uint64_t size = 448, double duration = -1) {
  cf::Bytes bytes; u32(bytes, 1); string(bytes, id); string(bytes, state); u32(bytes, ready);
  u64(bytes, size); u64(bytes, std::bit_cast<std::uint64_t>(duration)); return bytes;
}
int main() {
  using namespace cf;
  int calls = 0;
  OperationCall observed{};
  OperationReply reply{ReplyKind::Value, reply_bytes()};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call); done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  StreamVideoLibrary library(runtime, "STREAM");
  auto handler = [&]() -> Task {
    auto listed = co_await library.list({1, std::chrono::milliseconds(100)});
    assert(listed && listed.value().size() == 1);
    assert(observed.method == Operation::StreamVideoList && observed.binding == "STREAM");
    assert(observed.key.empty() && observed.body.empty() && observed.options == "1:100");
    const auto& info = listed.value()[0];
    assert(info.id == "owned-id" && info.state == "ready" && info.ready_to_stream && info.size_bytes == 448 && !info.duration);
    StreamVideoDetailsRequest request{"owned-id", std::chrono::milliseconds(100)};
    auto pending = library.details(request); request.id = "changed";
    auto found = co_await pending;
    assert(found && found.value().id == "owned-id");
    assert(observed.method == Operation::StreamVideoDetails && observed.key == "owned-id" && observed.body.empty() && observed.options == "100");
    for (const auto& id : std::vector<std::string>{"", std::string(129, 'x'), "a/b", "猫", "x\n"}) {
      auto bad = co_await library.details({id}); assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    for (auto input : std::vector<StreamVideoListRequest>{{0}, {51}, {1, std::chrono::milliseconds(0)}, {1, std::chrono::milliseconds(60001)}}) {
      auto bad = co_await library.list(input); assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    for (auto timeout : {0, 60001}) assert(!(co_await library.details({"id", std::chrono::milliseconds(timeout)})));
    assert(calls == 2);
    const auto good = reply.bytes;
    for (std::size_t length = 0; length < good.size(); ++length) {
      reply.bytes.assign(good.begin(), good.begin() + length);
      assert(!(co_await library.list({1})));
    }
    for (auto bytes : std::vector<Bytes>{Bytes{2,0,0,0}, Bytes{255,255,255,255},
        reply_bytes(""), reply_bytes(std::string(129, 'i')), reply_bytes("bad/id"), reply_bytes("猫"),
        reply_bytes("id", ""), reply_bytes("id", std::string(65, 's')), reply_bytes("id", "\xed\xa0\x80"),
        reply_bytes("id", "ready", 2), reply_bytes("id", "ready", 0, 9007199254740992ULL),
        reply_bytes("id", "ready", 1, 0, -0.5), reply_bytes("id", "ready", 1, 0, std::numeric_limits<double>::infinity()),
        reply_bytes("id", "ready", 1, 0, std::numeric_limits<double>::quiet_NaN()), Bytes(11005)}) {
      reply.bytes = std::move(bytes); assert(!(co_await library.list({1})));
    }
    reply.bytes = good; reply.bytes.push_back(0); assert(!(co_await library.list()));
    reply = {ReplyKind::Missing, good}; assert(!(co_await library.details({"owned-id"})));
    reply = {ReplyKind::Value, good}; assert(!(co_await library.details({"other-id"})));
    reply.bytes = Bytes(4);
    auto empty = co_await library.list({50, std::chrono::milliseconds(60000)});
    assert(empty && empty.value().empty());
    assert(!(co_await library.details({"owned-id"})));
    const auto record = reply_bytes(std::string(128, 'i'), std::string(64, 's'), 0, 9007199254740991ULL, 0.125);
    reply.bytes.clear(); u32(reply.bytes, 50);
    for (unsigned i = 0; i < 50; ++i) reply.bytes.insert(reply.bytes.end(), record.begin() + 4, record.end());
    assert(reply.bytes.size() == 11004);
    auto maximum = co_await library.list({50});
    assert(maximum && maximum.value().size() == 50);
    assert(maximum.value()[49].size_bytes == 9007199254740991ULL && maximum.value()[49].duration->count() == 0.125);
    reply.bytes = reply_bytes("owned-id", "\xef\xbb\xbf猫", 0, 0, 0);
    auto recovered = co_await library.details({"owned-id"}); reply.bytes.clear();
    assert(recovered && recovered.value().state == "\xef\xbb\xbf猫" && recovered.value().duration->count() == 0);
    co_return Response::text("ok");
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
