#pragma once
#include "cf/service.hpp"

namespace cf {
enum class RedirectMode { Manual, Error, Follow };
class HttpClient {
 public:
  explicit HttpClient(BindingRuntime runtime) : transport_(std::move(runtime), {}) {}
  [[nodiscard]] AsyncResult<Response> fetch(Request request, RedirectMode redirect = RedirectMode::Manual) const {
    if (request.url.empty() || request.url.size() > 65536)
      return ServiceBinding::invalid("HTTP URL must contain 1..65536 bytes");
    std::string mode;
    switch (redirect) {
      case RedirectMode::Manual: mode = "manual"; break;
      case RedirectMode::Error: mode = "error"; break;
      case RedirectMode::Follow: mode = "follow"; break;
      default: return ServiceBinding::invalid("invalid redirect mode");
    }
    return transport_.fetch(std::move(request), Operation::HttpFetch, std::move(mode));
  }
 private:
  ServiceBinding transport_;
};
}  // namespace cf
