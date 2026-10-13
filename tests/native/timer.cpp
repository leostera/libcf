#include <cassert>
#include "cf/timer.hpp"
#include "cf/task.hpp"
int main() {
  using namespace cf;
  using namespace std::chrono_literals;
  int calls = 0;
  Bytes expected{0, 0, 0, 0};
  OperationReply reply{ReplyKind::Value, {}};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::Sleep && call.binding.empty() && call.key.empty() && call.options.empty());
    assert(call.body == expected);
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Timer timer(runtime);
  auto handler = [&]() -> Task {
    assert((co_await timer.sleep(0ms)));
    expected = {0x60, 0xea, 0, 0};
    assert((co_await timer.sleep(60000ms)));
    reply.bytes.push_back(1);
    assert(!(co_await timer.sleep(60000ms)));
    reply = {ReplyKind::Missing, {}};
    assert(!(co_await timer.sleep(60000ms)));
    auto negative = co_await timer.sleep(-1ms);
    assert(!negative && negative.error().code == ErrorCode::InvalidInput);
    assert(!(co_await timer.sleep(60001ms)));
    assert(calls == 4);
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
