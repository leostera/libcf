#include <cassert>
#include "cf/service_tcp.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  int calls = 0;
  OperationReply reply{ReplyKind::Value, Bytes{0, 128, 255}};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::ServiceTcpExchange && call.binding == "BACKEND");
    assert(call.key == "echo.invalid:1234" && call.options == "5000:3");
    assert(call.body == (Bytes{0, 128, 255}));
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  ServiceTcp service(runtime, "BACKEND");
  auto handler = [&]() -> Task {
    ServiceTcpRequest request{.hostname = "echo.invalid", .port = 1234,
      .body = {0, 128, 255}, .response_limit = 3};
    auto pending = service.exchange(request);
    request.hostname = "changed"; request.body.clear();
    auto result = co_await pending;
    assert(result && result.value() == (Bytes{0, 128, 255}));
    ServiceTcpRequest valid{.hostname = "echo.invalid", .port = 1234,
      .body = {0, 128, 255}, .response_limit = 3};
    for (int mode = 0; mode < 8; ++mode) {
      auto invalid = valid;
      switch (mode) {
        case 0: invalid.hostname.clear(); break;
        case 1: invalid.hostname = "bad\n"; break;
        case 2: invalid.hostname.assign(254, 'x'); break;
        case 3: invalid.port = 0; break;
        case 4: invalid.timeout = std::chrono::milliseconds(0); break;
        case 5: invalid.timeout = std::chrono::milliseconds(60001); break;
        case 6: invalid.response_limit = 1048577; break;
        case 7: invalid.body.resize(1048577); break;
      }
      auto rejected = co_await service.exchange(invalid);
      assert(!rejected && rejected.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == 1);
    reply.bytes.resize(4);
    assert(!(co_await service.exchange(valid)));
    reply = {ReplyKind::Missing, {}};
    assert(!(co_await service.exchange(valid)));
    reply = {ReplyKind::Value, {}};
    auto empty = co_await service.exchange(valid);
    assert(empty && empty.value().empty() && calls == 4);
    co_return Response::text("ok");
  };
  auto task = handler().take(); task.resume();
  assert(task.done()); task.destroy();
}
