#include <cassert>
#include "cf/pipeline.hpp"
#include "cf/task.hpp"
int main() {
  using namespace cf;
  int calls = 0;
  OperationReply next{ReplyKind::Value, {}};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::PipelineSend && call.binding == "EVENTS");
    assert(std::string(call.body.begin(), call.body.end()) == "[{}]");
    done(Result<OperationReply>::success(next));
  }, [](auto) {});
  Pipeline pipeline(runtime, "EVENTS");
  auto handler = [&]() -> Task {
    assert((co_await pipeline.send_json("[{}]")));
    next.bytes.push_back(1);
    assert(!(co_await pipeline.send_json("[{}]")));
    next = {ReplyKind::Missing, {}};
    assert(!(co_await pipeline.send_json("[{}]")));
    auto empty = co_await pipeline.send_json("");
    assert(!empty && empty.error().code == ErrorCode::InvalidInput);
    std::string large(1048577, ' ');
    assert(!(co_await pipeline.send_json(std::move(large))));
    assert(calls == 3);
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
