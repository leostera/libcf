#pragma once
#include <chrono>
#include "cf/service.hpp"

namespace cf {
struct DispatchLimits {
  // Provider CPU budget, NOT a wall-clock timeout. These are SDK subset caps.
  std::chrono::milliseconds cpu_time{50};
  std::uint32_t sub_requests = 0;
};
struct DispatchTarget {
  std::string worker;
  DispatchLimits limits;
};
class DispatchNamespace {
 public:
  DispatchNamespace(BindingRuntime runtime, std::string binding)
      : service_(std::move(runtime), std::move(binding)) {}

  // The application must authorize the target and strip platform-only credentials.
  // No persistent Fetcher, props/capabilities, automatic retry or rollback promise.
  [[nodiscard]] AsyncResult<Response> fetch(DispatchTarget target, Request request) const {
    auto alnum = [](unsigned char c) {
      return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    };
    bool valid = !target.worker.empty() && target.worker.size() <= 63;
    if (valid) {
      valid = alnum(target.worker.front());
      for (unsigned char c : target.worker) valid = valid && (alnum(c) || c == '-' || c == '_');
    }
    const auto cpu = target.limits.cpu_time.count();
    if (!valid || cpu < 1 || cpu > 30000 || target.limits.sub_requests > 1000)
      return ServiceBinding::invalid("invalid dispatch target or limits");
    auto options = target.worker + ":" + std::to_string(cpu) + ":" + std::to_string(target.limits.sub_requests);
    return service_.fetch(std::move(request), Operation::DispatchFetch, std::move(options));
  }
 private:
  ServiceBinding service_;
};
}  // namespace cf
