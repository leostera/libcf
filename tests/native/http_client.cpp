#include <cassert>
#include "cf/http_client.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  int calls = 0;
  std::string expected = "manual";
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::HttpFetch && call.binding.empty());
    assert(call.key == "https://example.test/" && call.options == expected);
    done(Result<OperationReply>::failure({ErrorCode::HostFailure, "fixture failure"}));
  }, [](auto) {});
  HttpClient client(runtime);
  auto handler = [&]() -> Task {
    Request request;
    request.url = "https://example.test/";
    request.method = "GET";
    assert(!(co_await client.fetch(request)));
    expected = "follow";
    assert(!(co_await client.fetch(request, RedirectMode::Follow)));
    expected = "error";
    assert(!(co_await client.fetch(request, RedirectMode::Error)));
    auto invalid = co_await client.fetch(request, static_cast<RedirectMode>(255));
    assert(!invalid && invalid.error().code == ErrorCode::InvalidInput && calls == 3);
    request.url.clear();
    assert(!(co_await client.fetch(request)));
    request.url.assign(65537, 'x');
    assert(!(co_await client.fetch(request)));
    assert(calls == 3);
    co_return Response{};
  };
  auto task = handler().take();
  task.resume();
  assert(task.done());
  task.destroy();
}
