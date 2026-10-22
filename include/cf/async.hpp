#pragma once

#include <coroutine>
#include <functional>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "cf/result.hpp"

namespace cf {

template <typename T>
class AsyncResult;

namespace detail {
template <typename T>
class Gather;
}

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
  ~AsyncResult() {
    if (state_) state_->active = false;
  }

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
  friend class detail::Gather<T>;
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

namespace detail {

// Shared state of one when_all. Owned by the combined operation's Start
// function, so destroying the awaiting coroutine frame frees it; operations
// hold only weak references and late completions are ignored.
template <typename T>
class Gather : public std::enable_shared_from_this<Gather<T>> {
 public:
  using Results = std::vector<Result<T>>;

  Gather(std::vector<AsyncResult<T>> operations, std::size_t limit)
      : operations_(std::move(operations)), limit_(limit), settled_(operations_.size(), false) {
    results_.reserve(operations_.size());
    for (std::size_t index = 0; index < operations_.size(); ++index)
      results_.push_back(Result<T>::failure({ErrorCode::Aborted, "operation did not complete"}));
  }

  static typename AsyncResult<T>::Resume resume_of(const AsyncResult<T>& operation) {
    return operation.resume_;
  }

  void start(typename AsyncResult<Results>::Completion complete) {
    complete_ = std::move(complete);
    pump();
  }

 private:
  // Starts operations up to the limit. A loop rather than recursion, because
  // operations may complete inline from inside their Start function.
  void pump() {
    if (pumping_) return;
    pumping_ = true;
    auto self = this->shared_from_this();  // completion may release the owner
    while (next_ < operations_.size() && in_flight_ < limit_) {
      const auto index = next_++;
      ++in_flight_;
      std::weak_ptr<Gather> weak = self;
      auto start = std::move(operations_[index].start_);
      start([weak, index](Result<T> result) {
        if (auto gather = weak.lock()) gather->finish(index, std::move(result));
      });
    }
    pumping_ = false;
    if (done_ == operations_.size() && complete_) {
      // Last action: resuming the awaiting coroutine may destroy this object.
      auto complete = std::move(complete_);
      complete_ = nullptr;
      complete(Result<Results>::success(std::move(results_)));
    }
  }

  void finish(std::size_t index, Result<T> result) {
    if (index >= results_.size() || settled_[index]) return;
    results_[index] = std::move(result);
    settled_[index] = true;
    --in_flight_;
    ++done_;
    pump();
  }

  std::vector<AsyncResult<T>> operations_;
  std::size_t limit_;
  std::vector<bool> settled_;
  Results results_;
  typename AsyncResult<Results>::Completion complete_;
  std::size_t next_ = 0, in_flight_ = 0, done_ = 0;
  bool pumping_ = false;
};

}  // namespace detail

// Runs operations concurrently, at most `max_in_flight` at a time, and
// completes once every operation has settled. Results keep input order, and
// each keeps its own success or error. Starting is lazy, like any AsyncResult:
// nothing runs until the combined operation is awaited. Destroying the awaiting
// coroutine abandons the remaining operations; none of them resumes it.
// Workers allows six connections waiting for response headers per invocation,
// so fan-out to subrequests usually wants max_in_flight <= 6.
template <typename T>
[[nodiscard]] AsyncResult<std::vector<Result<T>>> when_all(std::vector<AsyncResult<T>> operations,
                                                          std::size_t max_in_flight) {
  using Results = std::vector<Result<T>>;
  if (max_in_flight == 0) {
    return AsyncResult<Results>(
        [](auto complete) {
          complete(Result<Results>::failure({ErrorCode::InvalidInput, "max_in_flight must be positive"}));
        },
        [](std::coroutine_handle<>) {});
  }
  auto resume = operations.empty() ? typename AsyncResult<Results>::Resume([](std::coroutine_handle<>) {})
                                   : typename AsyncResult<Results>::Resume(detail::Gather<T>::resume_of(operations.front()));
  auto gather = std::make_shared<detail::Gather<T>>(std::move(operations), max_in_flight);
  return AsyncResult<Results>([gather](auto complete) { gather->start(std::move(complete)); },
                              std::move(resume));
}

// Runs every operation at once; see the bounded overload.
template <typename T>
[[nodiscard]] AsyncResult<std::vector<Result<T>>> when_all(std::vector<AsyncResult<T>> operations) {
  const auto count = operations.size();
  return when_all(std::move(operations), count == 0 ? 1 : count);
}

}  // namespace cf
