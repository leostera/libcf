#include <cassert>
#include <vector>
#include "cf/ai.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  int calls = 0;
  OperationReply reply{ReplyKind::Value, Bytes{'{', '}'}};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::AiRunJson && call.binding == "AI");
    assert(call.key == "@cf/model" && call.options.empty());
    assert(call.body == (Bytes{'{', '}'}));
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Ai ai(runtime, "AI");
  auto handler = [&]() -> Task {
    AiRequest request{"@cf/model", "{}"};
    auto pending = ai.run_json(request);
    request.model = "changed";
    request.input_json = "changed";
    auto result = co_await pending;
    assert(result && result.value() == "{}");
    const std::vector<AiRequest> invalid{
      {"", "{}"}, {"bad\n", "{}"}, {std::string(257, 'x'), "{}"},
      {"@cf/model", ""}, {"@cf/model", std::string(1048577, 'x')},
    };
    for (const auto& input : invalid) {
      auto rejected = co_await ai.run_json(input);
      assert(!rejected && rejected.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == 1);
    AiRequest valid{"@cf/model", "{}"};
    reply.kind = ReplyKind::Missing;
    assert(!(co_await ai.run_json(valid)));
    reply = {ReplyKind::Value, {}};
    assert(!(co_await ai.run_json(valid)));
    reply.bytes.resize(1048577);
    assert(!(co_await ai.run_json(valid)));
    assert(calls == 4);
    co_return Response::text("ok");
  };
  auto task = handler().take();
  task.resume();
  assert(task.done());
  task.destroy();
}
