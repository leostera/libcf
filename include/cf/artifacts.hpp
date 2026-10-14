#pragma once
#include <chrono>
#include "cf/detail/text.hpp"
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
struct ArtifactsInfoOptions { std::chrono::milliseconds timeout{5000}; };
struct ArtifactsRepositoryInfo {
  std::string id;
  std::string name;
  std::string default_branch;
  bool read_only = false;
};

class Artifacts {
 public:
  Artifacts(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  // Existing named repository only: no creation or enumeration. Metadata is not
  // authorization, an atomic snapshot, or proof that native work/billing stopped.
  [[nodiscard]] AsyncResult<ArtifactsRepositoryInfo> info(
      std::string_view name, const ArtifactsInfoOptions& options = {}) const {
    const auto timeout = options.timeout.count();
    if (!valid_name(name) || timeout < 1 || timeout > 60000)
      return AsyncResult<ArtifactsRepositoryInfo>([](auto complete) {
        complete(Result<ArtifactsRepositoryInfo>::failure({ErrorCode::InvalidInput, "invalid Artifacts metadata request"}));
      }, [](std::coroutine_handle<>) {});
    // Validate before bounded copies; no borrowed view/options escape the call.
    return runtime_.call<ArtifactsRepositoryInfo>(
        {Operation::ArtifactsRepositoryInfo, binding_, std::string(name), {}, std::to_string(timeout)},
        [name = std::string(name)](OperationReply reply) { return decode(std::move(reply), name); });
  }
 private:
  static bool valid_name(std::string_view name) {
    if (name.empty() || name.size() > 128) return false;
    const auto alnum = [](unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'); };
    if (!alnum(static_cast<unsigned char>(name.front()))) return false;
    for (unsigned char c : name) if (!alnum(c) && c != '.' && c != '_' && c != '-') return false;
    return true;
  }
  static Result<ArtifactsRepositoryInfo> decode(OperationReply reply, std::string_view name) {
    const auto invalid = [] { return Result<ArtifactsRepositoryInfo>::failure(
        {ErrorCode::HostFailure, "invalid Artifacts metadata reply"}); };
    if (reply.kind != ReplyKind::Value || reply.bytes.size() < 19 || reply.bytes.size() > 528) return invalid();
    detail::WireReader wire(reply.bytes);
    ArtifactsRepositoryInfo info;
    std::uint32_t read_only = 0;
    if (!wire.u32(read_only) || read_only > 1 ||
        !wire.string(info.id) || !detail::bounded_utf8(info.id, 1, 128) ||
        !wire.string(info.name) || info.name != name ||
        !wire.string(info.default_branch) || !detail::bounded_utf8(info.default_branch, 1, 256) ||
        !wire.done()) return invalid();
    info.read_only = read_only == 1;
    return Result<ArtifactsRepositoryInfo>::success(std::move(info));
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
