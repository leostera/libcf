#include <cassert>
#include "cf/worker_loader.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  int calls = 0;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::WorkerLoaderFetch && call.binding == "LOADER");
    assert(call.options == "fixture-source" && call.key == "https://isolated.libcf.leostera.dev/");
    done(Result<OperationReply>::failure({ErrorCode::HostFailure, "fixture failure"}));
  }, [](auto) {});
  WorkerLoader loader(runtime, "LOADER");
  auto handler = [&]() -> Task {
    Request request;
    request.url = "https://isolated.libcf.leostera.dev/";
    request.method = "GET";
    auto empty = co_await loader.fetch("", request);
    assert(!empty && empty.error().code == ErrorCode::InvalidInput && calls == 0);
    std::string oversized(65537, 'x');
    auto large = co_await loader.fetch(std::move(oversized), request);
    assert(!large && calls == 0);
    auto failed = co_await loader.fetch("fixture-source", request);
    assert(!failed && failed.error().code == ErrorCode::HostFailure && calls == 1);
    co_return Response{};
  };
  auto task = handler().take();
  task.resume();
  assert(task.done());
  task.destroy();
}
