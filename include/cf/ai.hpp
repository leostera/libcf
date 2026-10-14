#pragma once

#include <string>
#include <utility>
#include "cf/operation.hpp"

namespace cf {
struct AiRequest {
  std::string model;
  std::string input_json;
};

// Model-specific JSON objects are parsed at the JS boundary. No remote retry.
class Ai {
 public:
  Ai(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  [[nodiscard]] AsyncResult<std::string> run_json(AiRequest request) const {
    const auto alnum = [](unsigned char c) {
      return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    };
    bool valid = !request.model.empty() && request.model.size() <= 256 &&
                 (alnum(request.model.front()) || request.model.front() == '@');
    if (valid) {
      for (unsigned char c : request.model) {
        if (!alnum(c) && c != '@' && c != '_' && c != '.' && c != '/' && c != ':' && c != '-') {
          valid = false;
          break;
        }
      }
    }
    if (!valid || request.input_json.empty() || request.input_json.size() > 1048576) {
      return AsyncResult<std::string>([](auto done) {
        done(Result<std::string>::failure({ErrorCode::InvalidInput, "invalid AI JSON request"}));
      }, [](std::coroutine_handle<>) {});
    }
    return runtime_.call<std::string>(
        {Operation::AiRunJson, binding_, std::move(request.model),
         Bytes(request.input_json.begin(), request.input_json.end()), {}},
        [](OperationReply reply) -> Result<std::string> {
          if (reply.kind != ReplyKind::Value || reply.bytes.empty() || reply.bytes.size() > 1048576)
            return Result<std::string>::failure({ErrorCode::InvalidInput, "malformed AI JSON reply"});
          return Result<std::string>::success(std::string(reply.bytes.begin(), reply.bytes.end()));
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
