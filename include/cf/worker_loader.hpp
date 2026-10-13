#pragma once

#include "cf/service.hpp"

namespace cf {
// A deliberately restricted loader: one JavaScript ES module, no bindings or
// outbound network access. Cache identity and policy are owned by the adapter.
class WorkerLoader {
 public:
  WorkerLoader(BindingRuntime runtime, std::string binding)
      : service_(std::move(runtime), std::move(binding)) {}
  [[nodiscard]] AsyncResult<Response> fetch(std::string source, Request request) const {
    if (source.empty() || source.size() > 65536)
      return ServiceBinding::invalid("dynamic Worker source must contain 1..65536 bytes");
    return service_.fetch(std::move(request), Operation::WorkerLoaderFetch, std::move(source));
  }
 private:
  ServiceBinding service_;
};
}  // namespace cf
