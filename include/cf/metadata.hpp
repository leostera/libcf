#pragma once

#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
struct WorkerVersion {
  std::string id;
  std::string tag;
  std::string timestamp;
};
class VersionMetadata {
 public:
  VersionMetadata(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] AsyncResult<WorkerVersion> get() const {
    return runtime_.call<WorkerVersion>({Operation::VersionMetadataGet, binding_, {}, {}, {}},
        [](OperationReply reply) {
          detail::WireReader wire(reply.bytes);
          WorkerVersion version;
          if (reply.kind != ReplyKind::Value || reply.bytes.size() > 65536 ||
              !wire.string(version.id) || !wire.string(version.tag) || !wire.string(version.timestamp) ||
              !wire.done() || version.id.empty() || version.timestamp.empty())
            return Result<WorkerVersion>::failure({ErrorCode::HostFailure, "invalid version metadata"});
          return Result<WorkerVersion>::success(std::move(version));
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
class SecretsStoreSecret {
 public:
  SecretsStoreSecret(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] AsyncResult<std::string> get() const {
    return runtime_.call<std::string>({Operation::SecretsStoreGet, binding_, {}, {}, {}},
        [](OperationReply reply) {
          if (reply.kind != ReplyKind::Value || reply.bytes.size() > 65536)
            return Result<std::string>::failure({ErrorCode::HostFailure, "invalid secret reply"});
          return Result<std::string>::success(std::string(reply.bytes.begin(), reply.bytes.end()));
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
