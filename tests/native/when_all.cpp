#include <cassert>
#include <algorithm>
#include <functional>
#include <optional>
#include <vector>

#include "cf/async.hpp"
#include "cf/task.hpp"

namespace {
using namespace cf;

// A fake host: each operation records its completion, to be settled later in
// any order, or completes inline when `inline_value` is set.
struct Host {
  std::vector<AsyncResult<int>::Completion> pending;
  int started = 0;
  int in_flight = 0;
  int peak = 0;
  int resumes = 0;
  std::coroutine_handle<> root;

  AsyncResult<int> operation(std::optional<int> inline_value = std::nullopt) {
    return AsyncResult<int>(
        [this, inline_value](AsyncResult<int>::Completion complete) {
          ++started;
          if (inline_value) {
            complete(Result<int>::success(*inline_value));
            return;
          }
          peak = std::max(peak, ++in_flight);
          pending.push_back(std::move(complete));
        },
        [this](std::coroutine_handle<>) {
          ++resumes;
          root.resume();
        });
  }

  void settle(std::size_t index, Result<int> result) {
    --in_flight;
    auto complete = std::move(pending.at(index));
    complete(std::move(result));
  }
};

// Coroutine parameters are copied into the frame, so `host` stays valid.
Task::Handle run(Host& host, Task (*body)(Host&)) {
  auto task = body(host).take();
  host.root = task;
  task.resume();
  return task;
}

Task empty_input(Host&) {
  auto results = co_await when_all(std::vector<AsyncResult<int>>{});
  assert(results && results.value().empty());
  co_return Response{};
}

Task unbounded(Host& host) {
  std::vector<AsyncResult<int>> operations;
  for (int index = 0; index < 3; ++index) operations.push_back(host.operation());
  auto combined = when_all(std::move(operations));
  assert(host.started == 0);
  auto results = co_await std::move(combined);
  assert(results && results.value().size() == 3);
  assert(results.value()[0].value() == 10);
  assert(!results.value()[1] && results.value()[1].error().message == "boom");
  assert(results.value()[2].value() == 30);
  co_return Response{};
}

Task bounded(Host& host) {
  std::vector<AsyncResult<int>> operations;
  for (int index = 0; index < 5; ++index) operations.push_back(host.operation());
  auto results = co_await when_all(std::move(operations), 2);
  assert(results && results.value().size() == 5);
  for (int index = 0; index < 5; ++index) assert(results.value()[index].value() == index);
  co_return Response{};
}

Task many_inline(Host& host) {
  std::vector<AsyncResult<int>> operations;
  for (int index = 0; index < 10000; ++index) operations.push_back(host.operation(index));
  auto results = co_await when_all(std::move(operations), 1);
  assert(results && results.value().size() == 10000 && results.value().back().value() == 9999);
  co_return Response{};
}

Task zero_limit(Host& host) {
  std::vector<AsyncResult<int>> operations;
  operations.push_back(host.operation());
  auto results = co_await when_all(std::move(operations), 0);
  assert(!results && results.error().code == ErrorCode::InvalidInput);
  co_return Response{};
}

Task abandoned(Host& host) {
  std::vector<AsyncResult<int>> operations;
  for (int index = 0; index < 4; ++index) operations.push_back(host.operation());
  (void)co_await when_all(std::move(operations), 2);
  assert(false);
  co_return Response{};
}
}  // namespace

int main() {
  // Empty input completes inline with no results.
  {
    Host host;
    auto task = run(host, empty_input);
    assert(task.done() && host.resumes == 0);
    task.destroy();
  }

  // Unbounded: everything starts at once, is lazy until awaited, keeps input
  // order and per-operation errors, and resumes exactly once.
  {
    Host host;
    auto task = run(host, unbounded);
    assert(host.started == 3 && host.peak == 3);
    host.settle(2, Result<int>::success(30));
    host.settle(0, Result<int>::success(10));
    assert(!task.done() && host.resumes == 0);
    host.settle(1, Result<int>::failure({ErrorCode::HostFailure, "boom"}));
    assert(task.done() && host.resumes == 1);
    task.destroy();
  }

  // Bounded: never more than two in flight; each completion starts the next.
  {
    Host host;
    auto task = run(host, bounded);
    assert(host.started == 2);
    host.settle(1, Result<int>::success(1));
    assert(host.started == 3);
    host.settle(0, Result<int>::success(0));
    host.settle(2, Result<int>::success(2));
    host.settle(3, Result<int>::success(3));
    host.settle(4, Result<int>::success(4));
    assert(task.done() && host.peak == 2 && host.resumes == 1);
    task.destroy();
  }

  // Many inline completions with a limit of one neither recurse nor resume.
  {
    Host host;
    auto task = run(host, many_inline);
    assert(task.done() && host.resumes == 0 && host.started == 10000);
    task.destroy();
  }

  // A zero limit is rejected without starting anything.
  {
    Host host;
    auto task = run(host, zero_limit);
    assert(task.done() && host.started == 0);
    task.destroy();
  }

  // Destroying the awaiting coroutine abandons the rest: late completions
  // neither resume it nor start further operations.
  {
    Host host;
    auto task = run(host, abandoned);
    assert(host.started == 2);
    task.destroy();
    host.settle(0, Result<int>::success(0));
    host.settle(1, Result<int>::success(1));
    assert(host.started == 2 && host.resumes == 0);
  }
}
