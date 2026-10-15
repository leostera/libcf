#pragma once

#include <coroutine>
#include <utility>

#include "cf/http.hpp"

namespace cf {

// A move-only, lazily started HTTP handler. The host adapter owns the handle
// after take(); it must resume it when I/O completes and destroy it at final
// suspension or on cancellation. Keeping final_suspend suspended avoids a
// use-after-free when completion is observed by the host.
class Task {
 public:
  struct promise_type {
    Response response;

    Task get_return_object() {
      return Task(std::coroutine_handle<promise_type>::from_promise(*this));
    }
    std::suspend_always initial_suspend() noexcept { return {}; }
    std::suspend_always final_suspend() noexcept { return {}; }
    void return_value(Response value) { response = std::move(value); }
    void unhandled_exception() { response = Response::text("internal error", 500); }
  };

  using Handle = std::coroutine_handle<promise_type>;

  Task(const Task&) = delete;
  Task& operator=(const Task&) = delete;
  Task(Task&& other) noexcept : handle_(std::exchange(other.handle_, {})) {}
  Task& operator=(Task&& other) noexcept {
    if (this != &other) {
      if (handle_) handle_.destroy();
      handle_ = std::exchange(other.handle_, {});
    }
    return *this;
  }
  ~Task() {
    if (handle_) handle_.destroy();
  }

  [[nodiscard]] Handle take() noexcept { return std::exchange(handle_, {}); }

 private:
  explicit Task(Handle handle) : handle_(handle) {}
  Handle handle_;
};

}  // namespace cf
