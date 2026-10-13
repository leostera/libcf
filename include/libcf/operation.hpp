#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

#include "libcf/async.hpp"

namespace libcf {

using Bytes = std::vector<std::uint8_t>;

// Version 1 of the C++/JS operation protocol. Numeric values are shared with
// lib/runtime.mjs; add new values, never silently reinterpret existing ones.
enum class Operation : std::uint8_t {
  KvGetText = 1,
  KvPut = 2,
  KvDelete = 3,
  KvList = 4,
  KvGetBytes = 5,
  KvGetMetadata = 6,
};

struct OperationCall {
  Operation method;
  std::string binding;
  std::string key;
  Bytes body;
  std::string options;
};

enum class ReplyKind : std::uint8_t { Value, Missing };

struct OperationReply {
  ReplyKind kind;
  Bytes bytes;
};

class BindingRuntime {
 public:
  using Completion = std::function<void(Result<OperationReply>)>;
  using Start = std::function<void(OperationCall, Completion)>;
  using Resume = AsyncResult<OperationReply>::Resume;

  BindingRuntime(Start start, Resume resume)
      : start_(std::move(start)), resume_(std::move(resume)) {}

  template <typename T, typename Decode>
  [[nodiscard]] AsyncResult<T> call(OperationCall call, Decode decode) const {
    return AsyncResult<T>(
        [start = start_, call = std::move(call), decode = std::move(decode)](
            typename AsyncResult<T>::Completion finish) mutable {
          start(std::move(call), [finish = std::move(finish), decode = std::move(decode)](
                                      Result<OperationReply> result) mutable {
            if (!result) {
              finish(Result<T>::failure(result.error()));
              return;
            }
            finish(decode(std::move(result.value())));
          });
        }, resume_);
  }

 private:
  Start start_;
  Resume resume_;
};

}  // namespace libcf
