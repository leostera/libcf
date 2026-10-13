#pragma once
#include "cf/operation.hpp"

namespace cf {
enum class WorkflowState : std::uint8_t {
  Queued, Running, Paused, Errored, Terminated, Complete, Waiting, WaitingForPause, RollingBack, Unknown
};
class Workflow {
 public:
  Workflow(BindingRuntime runtime, std::string binding) : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] AsyncResult<Unit> create(std::string id, std::string params_json) const {
    if (!valid_id(id) || params_json.empty() || params_json.size() > 1048576)
      return invalid<Unit>();
    return runtime_.call<Unit>({Operation::WorkflowCreate, binding_, std::move(id),
        Bytes(params_json.begin(), params_json.end()), {}}, decode_unit);
  }
  [[nodiscard]] AsyncResult<Unit> send_event_json(std::string id, std::string event_type,
                                                 std::string payload_json) const {
    if (!valid_id(id) || !valid_id(event_type) || payload_json.empty() || payload_json.size() > 1048576)
      return invalid<Unit>();
    return runtime_.call<Unit>({Operation::WorkflowSendEvent, binding_, std::move(id),
        Bytes(payload_json.begin(), payload_json.end()), std::move(event_type)}, decode_unit);
  }
  // Reports only lifecycle state, not output or error details.
  [[nodiscard]] AsyncResult<WorkflowState> state(std::string id) const {
    if (!valid_id(id)) return invalid<WorkflowState>();
    return runtime_.call<WorkflowState>({Operation::WorkflowStateGet, binding_, std::move(id), {}, {}},
        [](OperationReply reply) {
          if (reply.kind != ReplyKind::Value || reply.bytes.size() != 1 || reply.bytes[0] > 9)
            return Result<WorkflowState>::failure({ErrorCode::HostFailure, "invalid workflow state"});
          return Result<WorkflowState>::success(static_cast<WorkflowState>(reply.bytes[0]));
        });
  }
  [[nodiscard]] AsyncResult<Unit> erase(std::string id) const {
    if (!valid_id(id)) return invalid<Unit>();
    return runtime_.call<Unit>({Operation::WorkflowDelete, binding_, std::move(id), {}, {}}, decode_unit);
  }
 private:
  static bool valid_id(std::string_view id) {
    if (id.empty() || id.size() > 100 || id.front() == '-') return false;
    for (const unsigned char c : id)
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-'))
        return false;
    return true;
  }
  template<class T> static AsyncResult<T> invalid() {
    return AsyncResult<T>([](auto complete) {
      complete(Result<T>::failure({ErrorCode::InvalidInput, "invalid workflow ID, event type or JSON input size"}));
    }, [](std::coroutine_handle<>) {});
  }
  static Result<Unit> decode_unit(OperationReply reply) {
    if (reply.kind != ReplyKind::Value || !reply.bytes.empty())
      return Result<Unit>::failure({ErrorCode::HostFailure, "invalid workflow acknowledgement"});
    return Result<Unit>::success({});
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
