#pragma once
#include <chrono>
#include <string>
#include <string_view>
#include "cf/operation.hpp"

namespace cf {
struct BoundHttpsGetOptions { std::chrono::milliseconds timeout{5000}; };
namespace detail {
template <Operation Method>
class BoundHttpsClient {
  static_assert(Method == Operation::MtlsGet || Method == Operation::VpcServiceGet || Method == Operation::VpcNetworkGet);
 public:
  BoundHttpsClient(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  // Select a trusted configured endpoint, never a caller URL. Only an
  // unredirected HTTP200 body is supported; GET is not side-effect proof.
  [[nodiscard]] AsyncResult<Bytes> get_bytes(
      std::string_view endpoint, const BoundHttpsGetOptions& options = {}) const {
    const auto timeout = options.timeout.count();
    if (!valid_selector(binding_, true) || !valid_selector(endpoint, false) || timeout < 1 || timeout > 60000)
      return AsyncResult<Bytes>([](auto done) {
        done(Result<Bytes>::failure({ErrorCode::InvalidInput, "invalid outbound GET request"}));
      }, [](std::coroutine_handle<>) {});
    // Bound selectors before copying them into the asynchronous operation.
    return runtime_.call<Bytes>(
        {Method, binding_, std::string(endpoint), {}, std::to_string(timeout)},
        [](OperationReply reply) {
          if (reply.kind != ReplyKind::Value || reply.bytes.size() > 1048576)
            return Result<Bytes>::failure({ErrorCode::HostFailure, "invalid outbound GET reply"});
          return Result<Bytes>::success(std::move(reply.bytes));
        });
  }
 private:
  static bool valid_selector(std::string_view value, bool binding) {
    if (value.empty() || value.size() > 64) return false;
    const auto letter = [binding](char c) { return binding ? c >= 'A' && c <= 'Z' : c >= 'a' && c <= 'z'; };
    if (!letter(value.front())) return false;
    for (char c : value) if (!letter(c) && !(c >= '0' && c <= '9') && c != (binding ? '_' : '-')) return false;
    return true;
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace detail
// Distinct types/operation codes prevent runtime role selection or cross-role
// fallback. Their names do not prove binding provenance, TLS identity or routing.
using MtlsHttp = detail::BoundHttpsClient<Operation::MtlsGet>;
using VpcServiceHttp = detail::BoundHttpsClient<Operation::VpcServiceGet>;
using VpcNetworkHttp = detail::BoundHttpsClient<Operation::VpcNetworkGet>;
}  // namespace cf
