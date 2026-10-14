#pragma once
#include <chrono>
#include <optional>
#include <string>
#include <string_view>
#include "cf/operation.hpp"

namespace cf {
struct AiGatewayUrlOptions {
  std::optional<std::string> provider;
  std::chrono::milliseconds timeout{5000};
};
// Canonical endpoint metadata, not gateway/account ownership or fetch authority.
struct AiGatewayEndpoint { std::string url; };
class AiGateway {
 public:
  AiGateway(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  // Native getUrl performs a backend GET. No inference, log access, retry or
  // fetch of the returned endpoint; cancellation does not prove backend work stopped.
  [[nodiscard]] AsyncResult<AiGatewayEndpoint> lookup_url(
      std::string_view gateway_id, const AiGatewayUrlOptions& options = {}) const {
    const auto timeout = options.timeout.count();
    if (!valid_token(gateway_id, 64, lowercase_alnum) ||
        (options.provider && !valid_token(*options.provider, 64, lowercase_alnum)) ||
        timeout < 1 || timeout > 60000)
      return AsyncResult<AiGatewayEndpoint>([](auto done) {
        done(Result<AiGatewayEndpoint>::failure({ErrorCode::InvalidInput, "invalid AI Gateway URL request"}));
      }, [](std::coroutine_handle<>) {});
    // Validate before bounded snapshots. Explicit empty provider is invalid,
    // whereas absent provider omits the native getUrl argument.
    Bytes body;
    if (options.provider) body.assign(options.provider->begin(), options.provider->end());
    return runtime_.call<AiGatewayEndpoint>(
        {Operation::AiGatewayUrl, binding_, std::string(gateway_id), std::move(body), std::to_string(timeout)},
        [id = std::string(gateway_id), provider = options.provider](OperationReply reply) {
          return decode(std::move(reply), id, provider);
        });
  }
 private:
  static constexpr std::string_view prefix = "https://gateway.ai.cloudflare.com/v1/";
  static constexpr std::size_t max_url_bytes = prefix.size() + 128 + 1 + 64 + 1 + 64;
  static constexpr std::string_view lowercase_alnum = "abcdefghijklmnopqrstuvwxyz0123456789";
  static constexpr std::string_view account_alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  static bool valid_token(std::string_view value, std::size_t maximum, std::string_view alphabet) {
    if (value.empty() || value.size() > maximum || alphabet.find(value.front()) == std::string_view::npos) return false;
    for (char c : value) if (c != '-' && alphabet.find(c) == std::string_view::npos) return false;
    return true;
  }
  static Result<AiGatewayEndpoint> decode(OperationReply reply, const std::string& id, const std::optional<std::string>& provider) {
    const auto invalid = [] { return Result<AiGatewayEndpoint>::failure({ErrorCode::HostFailure, "invalid AI Gateway URL reply"}); };
    if (reply.kind != ReplyKind::Value || reply.bytes.size() < prefix.size() + 4 || reply.bytes.size() > max_url_bytes) return invalid();
    std::string url(reply.bytes.begin(), reply.bytes.end());
    if (!url.starts_with(prefix)) return invalid();
    const auto end = url.find('/', prefix.size());
    if (end == std::string::npos) return invalid();
    const auto account = std::string_view(url).substr(prefix.size(), end - prefix.size());
    if (!valid_token(account, 128, account_alnum)) return invalid();
    const std::string suffix = !provider || *provider == "universal" ? "" : *provider;
    if (url != std::string(prefix) + std::string(account) + "/" + id + "/" + suffix) return invalid();
    return Result<AiGatewayEndpoint>::success({std::move(url)});
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
