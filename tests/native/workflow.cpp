#include <cassert>
#include "cf/workflow.hpp"
#include "cf/task.hpp"
int main() {
  using namespace cf;
  int calls = 0;
  auto expected = Operation::WorkflowCreate;
  OperationReply reply{ReplyKind::Value, {}};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == expected && call.binding == "FLOW" && call.key == "fixture" && call.options.empty());
    if (expected == Operation::WorkflowCreate)
      assert(std::string(call.body.begin(), call.body.end()) == "{}");
    else assert(call.body.empty());
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Workflow workflow(runtime, "FLOW");
  auto handler = [&]() -> Task {
    assert((co_await workflow.create("fixture", "{}")));
    reply.bytes = {1};
    assert(!(co_await workflow.create("fixture", "{}")));
    expected = Operation::WorkflowStateGet;
    constexpr WorkflowState states[]{WorkflowState::Queued, WorkflowState::Running,
      WorkflowState::Paused, WorkflowState::Errored, WorkflowState::Terminated,
      WorkflowState::Complete, WorkflowState::Waiting, WorkflowState::WaitingForPause,
      WorkflowState::RollingBack, WorkflowState::Unknown};
    for (std::uint8_t state = 0; state < 10; ++state) {
      reply.bytes = {state};
      auto result = co_await workflow.state("fixture");
      assert(result && result.value() == states[state]);
    }
    reply.bytes = {10};
    assert(!(co_await workflow.state("fixture")));
    reply.bytes.clear();
    assert(!(co_await workflow.state("fixture")));
    expected = Operation::WorkflowDelete;
    assert((co_await workflow.erase("fixture")));
    reply.kind = ReplyKind::Missing;
    assert(!(co_await workflow.erase("fixture")));
    const auto baseline = calls;
    for (const std::string id : {"", "-bad", "bad space", "bad\n"}) {
      assert(!(co_await workflow.create(id, "{}")));
      assert(!(co_await workflow.state(id)));
      assert(!(co_await workflow.erase(id)));
    }
    assert(!(co_await workflow.state(std::string(101, 'a'))));
    assert(!(co_await workflow.create("fixture", "")));
    assert(!(co_await workflow.create("fixture", std::string(1048577, ' '))));
    assert(calls == baseline);
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
