#pragma once

#include <string>
#include <utility>
#include "cf/operation.hpp"

namespace cf {
// JSON text is parsed/encoded at the JS boundary, not by a bundled C++ parser.
class RpcService {
 public:
  RpcService(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  [[nodiscard]] AsyncResult<std::string> call_json(std::string method,
                                                  std::string arguments_json = "[]") const {
    const auto letter = [](unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); };
    bool valid = !method.empty() && method.size() <= 100 && letter(method.front());
    if (valid) {
      for (unsigned char c : method) {
        if (!letter(c) && !(c >= '0' && c <= '9') && c != '_') {
          valid = false;
          break;
        }
      }
    }
    if (!valid || arguments_json.empty() || arguments_json.size() > 1048576) {
      return AsyncResult<std::string>([](auto done) {
        done(Result<std::string>::failure({ErrorCode::InvalidInput, "invalid RPC request"}));
      }, [](std::coroutine_handle<>) {});
    }
    return runtime_.call<std::string>(
        {Operation::RpcCallJson, binding_, std::move(method),
         Bytes(arguments_json.begin(), arguments_json.end()), {}},
        [](OperationReply reply) -> Result<std::string> {
          if (reply.kind != ReplyKind::Value || reply.bytes.empty() || reply.bytes.size() > 1048576)
            return Result<std::string>::failure({ErrorCode::InvalidInput, "malformed RPC JSON reply"});
          return Result<std::string>::success(std::string(reply.bytes.begin(), reply.bytes.end()));
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
