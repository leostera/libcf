#pragma once
#include "cf/operation.hpp"

namespace cf {
class Pipeline {
 public:
  Pipeline(BindingRuntime runtime, std::string binding) : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  // JSON is parsed and bounded at the JS boundary before invoking the provider.
  [[nodiscard]] AsyncResult<Unit> send_json(std::string batch) const {
    if (batch.empty() || batch.size() > 1048576)
      return AsyncResult<Unit>([](auto complete) {
        complete(Result<Unit>::failure({ErrorCode::InvalidInput, "JSON batch must contain 1..1048576 bytes"}));
      }, [](std::coroutine_handle<>) {});
    return runtime_.call<Unit>({Operation::PipelineSend, binding_, {}, Bytes(batch.begin(), batch.end()), {}},
        [](OperationReply reply) {
          if (reply.kind != ReplyKind::Value || !reply.bytes.empty())
            return Result<Unit>::failure({ErrorCode::HostFailure, "invalid pipeline acknowledgement"});
          return Result<Unit>::success({});
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
