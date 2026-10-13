#pragma once

#include <coroutine>
#include <functional>
#include <string>
#include <utility>

#include "libcf/async.hpp"

namespace libcf {

struct FetchedResponse {
  int status;
  std::string body;

  [[nodiscard]] bool ok() const noexcept { return status >= 200 && status < 300; }
};

using FetchResult = Result<FetchedResponse>;

class Fetcher {
 public:
  using Completion = AsyncResult<FetchedResponse>::Completion;
  using Start = std::function<void(std::string, Completion)>;
  using Resume = AsyncResult<FetchedResponse>::Resume;

  Fetcher(Start start, Resume resume) : start_(std::move(start)), resume_(std::move(resume)) {}

  [[nodiscard]] AsyncResult<FetchedResponse> get(std::string url) const {
    return AsyncResult<FetchedResponse>(
        [start = start_, url = std::move(url)](Completion done) mutable {
          start(std::move(url), std::move(done));
        }, resume_);
  }

 private:
  Start start_;
  Resume resume_;
};

}  // namespace libcf
