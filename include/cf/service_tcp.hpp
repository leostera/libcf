#pragma once
#include <chrono>
#include "cf/operation.hpp"

namespace cf {
struct ServiceTcpRequest {
  // A virtual address delivered to the bound Worker, not an external DNS target.
  std::string hostname;
  std::uint16_t port = 0;
  Bytes body;
  std::chrono::milliseconds timeout{5000};
  std::uint32_t response_limit = 1048576;
};

class ServiceTcp {
 public:
  ServiceTcp(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  // Write owned bytes, half-close, and collect bounded bytes through peer EOF.
  // No TLS, persistent handle, automatic retry or remote rollback guarantee.
  [[nodiscard]] AsyncResult<Bytes> exchange(ServiceTcpRequest request) const {
    auto alnum = [](unsigned char c) {
      return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    };
    bool valid = !request.hostname.empty() && request.hostname.size() <= 253;
    if (valid) {
      valid = alnum(request.hostname.front()) && alnum(request.hostname.back());
      for (unsigned char c : request.hostname) valid = valid && (alnum(c) || c == '.' || c == '-');
    }
    const auto timeout = request.timeout.count();
    const auto limit = request.response_limit;
    if (!valid || request.port == 0 || request.body.size() > 1048576 ||
        timeout < 1 || timeout > 60000 || limit < 1 || limit > 1048576)
      return AsyncResult<Bytes>([](auto complete) {
        complete(Result<Bytes>::failure({ErrorCode::InvalidInput, "invalid service TCP request"}));
      }, [](std::coroutine_handle<>) {});
    auto address = request.hostname + ":" + std::to_string(request.port);
    auto options = std::to_string(timeout) + ":" + std::to_string(limit);
    return runtime_.call<Bytes>({Operation::ServiceTcpExchange, binding_, std::move(address),
        std::move(request.body), std::move(options)}, [limit](OperationReply reply) {
      if (reply.kind != ReplyKind::Value || reply.bytes.size() > limit)
        return Result<Bytes>::failure({ErrorCode::HostFailure, "invalid service TCP reply"});
      return Result<Bytes>::success(std::move(reply.bytes));
    });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
