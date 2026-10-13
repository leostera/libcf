#pragma once

#include <coroutine>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace libcf {

struct FetchResult {
  int status = 0;  // 0 means the binding/network operation failed.
  std::string body;
  std::string error;

  [[nodiscard]] bool ok() const noexcept { return status >= 200 && status < 300; }
};

class Fetcher {
 public:
  using Completion = std::function<void(FetchResult)>;
  using Start = std::function<void(std::string, Completion)>;
  using Resume = std::function<void(std::coroutine_handle<>)>;

  Fetcher(Start start, Resume resume) : start_(std::move(start)), resume_(std::move(resume)) {}

  class Awaitable {
   public:
    Awaitable(Start start, Resume resume, std::string url)
        : start_(std::move(start)), resume_(std::move(resume)), url_(std::move(url)),
          state_(std::make_shared<State>()) {}
    Awaitable(const Awaitable&) = delete;
    Awaitable& operator=(const Awaitable&) = delete;
    Awaitable(Awaitable&&) noexcept = default;
    ~Awaitable() { if (state_) state_->active = false; }

    bool await_ready() const noexcept { return false; }
    bool await_suspend(std::coroutine_handle<> handle) {
      auto state = state_;
      state->handle = handle;
      std::weak_ptr<State> weak_state = state;
      auto resume = resume_;
      start_(std::move(url_), [weak_state, resume = std::move(resume)](FetchResult result) {
        if (auto current = weak_state.lock(); current && current->active) {
          current->result = std::move(result);
          if (!current->suspending) resume(current->handle);
        }
      });
      // A host may complete inline. In that case the coroutine must never be
      // resumed recursively while await_suspend is still on the stack.
      state->suspending = false;
      return !state->result.has_value();
    }
    FetchResult await_resume() { return std::move(*state_->result); }

   private:
    struct State {
      bool active = true;
      bool suspending = true;
      std::coroutine_handle<> handle;
      std::optional<FetchResult> result;
    };
    Start start_;
    Resume resume_;
    std::string url_;
    std::shared_ptr<State> state_;
  };

  [[nodiscard]] Awaitable get(std::string url) const {
    return Awaitable(start_, resume_, std::move(url));
  }

 private:
  Start start_;
  Resume resume_;
};

}  // namespace libcf
