#include <cassert>
#include "cf/task.hpp"
#include "cf/vectorize.hpp"

static void u32(cf::Bytes& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
static cf::Bytes reply_bytes(std::string id, double score) {
  cf::Bytes bytes;
  u32(bytes, 1);
  u32(bytes, static_cast<std::uint32_t>(id.size()));
  bytes.insert(bytes.end(), id.begin(), id.end());
  auto bits = std::bit_cast<std::uint64_t>(score);
  u32(bytes, static_cast<std::uint32_t>(bits));
  u32(bytes, static_cast<std::uint32_t>(bits >> 32));
  return bytes;
}
int main() {
  using namespace cf;
  int calls = 0;
  OperationCall observed{};
  OperationReply reply{ReplyKind::Value, reply_bytes("猫", -0.25)};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    observed = std::move(call);
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Vectorize index(runtime, "INDEX");
  auto handler = [&]() -> Task {
    VectorizeQuery input{{1, 0, -0.5f}, 5, std::chrono::milliseconds(100)};
    auto pending = index.query(input);
    input.values.assign(3, 99);
    auto result = co_await pending;
    assert(result && result.value().size() == 1);
    assert(result.value()[0].id == "猫" && result.value()[0].score == -0.25);
    assert(observed.method == Operation::VectorizeQuery && observed.binding == "INDEX");
    assert(observed.key.empty() && observed.options == "5:100");
    assert(observed.body == (Bytes{0,0,128,63, 0,0,0,0, 0,0,0,191}));
    const std::vector<VectorizeQuery> invalid{
      {{}, 1}, {std::vector<float>(1537, 1), 1}, {{1}, 0}, {{1}, 101},
      {{std::numeric_limits<float>::infinity()}, 1}, {{std::numeric_limits<float>::quiet_NaN()}, 1},
      {{1}, 1, std::chrono::milliseconds(0)}, {{1}, 1, std::chrono::milliseconds(60001)},
    };
    for (const auto& query : invalid) {
      auto rejected = co_await index.query(query);
      assert(!rejected && rejected.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == 1);
    const auto good = reply.bytes;
    for (std::size_t length = 0; length < good.size(); ++length) {
      reply.bytes.assign(good.begin(), good.begin() + length);
      assert(!(co_await index.query({{1}, 1})));
    }
    for (auto bytes : std::vector<Bytes>{Bytes{2, 0, 0, 0}, reply_bytes("", 0), reply_bytes(std::string(65, 'x'), 0),
        reply_bytes("x", std::numeric_limits<double>::infinity()),
        reply_bytes("x", std::numeric_limits<double>::quiet_NaN()), Bytes(7605)}) {
      reply.bytes = std::move(bytes);
      assert(!(co_await index.query({{1}, 1})));
    }
    reply.bytes = good;
    reply.bytes.push_back(0);
    assert(!(co_await index.query({{1}, 1})));
    reply = {ReplyKind::Missing, good};
    assert(!(co_await index.query({{1}, 1})));
    reply = {ReplyKind::Value, Bytes(4)};
    auto empty = co_await index.query({std::vector<float>(1536, 1), 100, std::chrono::milliseconds(60000)});
    assert(empty && empty.value().empty());
    reply.bytes = reply_bytes("x", 10000.125);
    auto recovered = co_await index.query({{1}, 1});
    assert(recovered && recovered.value()[0].score == 10000.125);
    co_return Response::text("ok");
  };
  auto task = handler().take();
  task.resume();
  assert(task.done());
  task.destroy();
}
