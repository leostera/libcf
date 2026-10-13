#pragma once

#include <coroutine>
#include <functional>
#include <memory>
#include <optional>
#include <utility>

#include "libcf/result.hpp"

namespace libcf {

// One host Promise -> one C++ coroutine continuation. The awaitable is owned
// by the coroutine frame; a late callback holds only a weak reference, so
// cancelling/destroying a suspended request cannot resume freed memory.
// Completion and resume run on the same isolate thread as await_suspend.
template <typename T>
class AsyncResult {
 public:
  using Completion = std::function<void(Result<T>)>;
  using Start = std::function<void(Completion)>;
  using Resume = std::function<void(std::coroutine_handle<>)>;

  AsyncResult(Start start, Resume resume)
      : start_(std::move(start)), resume_(std::move(resume)), state_(std::make_shared<State>()) {}
  AsyncResult(const AsyncResult&) = delete;
  AsyncResult& operator=(const AsyncResult&) = delete;
  AsyncResult(AsyncResult&&) noexcept = default;
  ~AsyncResult() { if (state_) state_->active = false; }

  bool await_ready() const noexcept { return false; }
  bool await_suspend(std::coroutine_handle<> handle) {
    auto state = state_;
    state->handle = handle;
    std::weak_ptr<State> weak_state = state;
    auto resume = resume_;
    start_([weak_state, resume = std::move(resume)](Result<T> result) {
      if (auto current = weak_state.lock(); current && current->active && !current->completed) {
        // Claim completion before resuming: resume may synchronously start a
        // second operation or destroy this awaitable's coroutine frame.
        current->completed = true;
        current->result = std::move(result);
        if (!current->suspending) resume(current->handle);
      }
    });
    // Host adapters are allowed to complete inline. Do not recursively resume
    // while await_suspend is still on the C++ stack.
    state->suspending = false;
    return !state->result.has_value();
  }
  Result<T> await_resume() { return std::move(*state_->result); }

 private:
  struct State {
    bool active = true;
    bool completed = false;
    bool suspending = true;
    std::coroutine_handle<> handle;
    std::optional<Result<T>> result;
  };
  Start start_;
  Resume resume_;
  std::shared_ptr<State> state_;
};

}  // namespace libcf
