#pragma once
#include <bit>
#include <chrono>
#include <limits>
#include <optional>
#include "cf/detail/text.hpp"
#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {
// Explicit get-or-create behavior: an absent profile may be created. This is
// a selector, not an existing-profile receipt or application authorization.
struct GetOrCreateMemoryProfile { std::string name; };
struct AgentMemoryListOptions {
  std::uint32_t limit = 20;
  std::optional<std::string> cursor;
  std::chrono::milliseconds timeout{5000};
};
enum class AgentMemoryType : std::uint32_t { Fact = 0, Event = 1, Instruction = 2, Task = 3 };
using AgentMemoryTime = std::chrono::sys_time<std::chrono::milliseconds>;
static_assert(std::numeric_limits<std::chrono::milliseconds::rep>::digits >= 63);
struct AgentMemoryEntry {
  std::string id;
  AgentMemoryType type = AgentMemoryType::Fact;
  std::string summary;
  std::optional<std::string> session_id;
  AgentMemoryTime created_at;
  AgentMemoryTime updated_at;
};
struct AgentMemoryPage {
  std::vector<AgentMemoryEntry> memories;
  std::optional<std::string> cursor;
};

class AgentMemory {
 public:
  AgentMemory(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  // Calls getProfile then list. A profile may be created even if listing fails
  // or times out. No rollback/deletion, native-work cancellation or billing bound.
  [[nodiscard]] AsyncResult<AgentMemoryPage> list_memories(
      GetOrCreateMemoryProfile profile, const AgentMemoryListOptions& options = {}) const {
    const auto timeout = options.timeout.count();
    if (!valid_profile(profile.name) || options.limit < 1 || options.limit > 50 || timeout < 1 || timeout > 60000 ||
        (options.cursor && !detail::bounded_utf8(*options.cursor, 1, 2048)))
      return AsyncResult<AgentMemoryPage>([](auto complete) {
        complete(Result<AgentMemoryPage>::failure({ErrorCode::InvalidInput, "invalid Agent Memory list request"}));
      }, [](std::coroutine_handle<>) {});
    Bytes cursor;
    if (options.cursor) cursor.assign(options.cursor->begin(), options.cursor->end());
    return runtime_.call<AgentMemoryPage>(
        {Operation::AgentMemoryListCreatingProfile, binding_, std::move(profile.name), std::move(cursor),
         std::to_string(options.limit) + ":" + std::to_string(timeout)},
        [limit = options.limit](OperationReply reply) { return decode(std::move(reply), limit); });
  }
 private:
  static bool valid_profile(std::string_view name) {
    if (name.empty() || name.size() > 100) return false;
    for (unsigned char c : name)
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
    return true;
  }
  static bool optional_text(detail::WireReader& wire, std::optional<std::string>& value, std::size_t minimum, std::size_t maximum) {
    std::uint32_t present = 0;
    if (!wire.u32(present) || present > 1) return false;
    if (present == 0) { value.reset(); return true; }
    std::string text;
    if (!wire.string(text) || !detail::bounded_utf8(text, minimum, maximum)) return false;
    value = std::move(text);
    return true;
  }
  static bool time(detail::WireReader& wire, AgentMemoryTime& value) {
    std::uint32_t low = 0, high = 0;
    if (!wire.u32(low) || !wire.u32(high)) return false;
    const auto milliseconds = std::bit_cast<std::int64_t>((static_cast<std::uint64_t>(high) << 32) | low);
    if (milliseconds < -8640000000000000LL || milliseconds > 8640000000000000LL) return false;
    // Keep millisecond duration; narrowing to the clock's nanoseconds can overflow.
    value = AgentMemoryTime{std::chrono::milliseconds{milliseconds}};
    return true;
  }
  static Result<AgentMemoryPage> decode(OperationReply reply, std::uint32_t limit) {
    auto invalid = [] { return Result<AgentMemoryPage>::failure({ErrorCode::HostFailure, "invalid Agent Memory list reply"}); };
    if (reply.kind != ReplyKind::Value || reply.bytes.size() > 2060 + limit * 4324) return invalid();
    detail::WireReader wire(reply.bytes);
    std::uint32_t count = 0;
    AgentMemoryPage page;
    if (!wire.u32(count) || count > limit || !optional_text(wire, page.cursor, 1, 2048)) return invalid();
    page.memories.reserve(count);
    for (std::uint32_t i = 0; i < count; ++i) {
      AgentMemoryEntry memory;
      std::uint32_t type = 0;
      if (!wire.string(memory.id) || !detail::bounded_utf8(memory.id, 1, 128) || !wire.u32(type) || type > 3 ||
          !wire.string(memory.summary) || !detail::bounded_utf8(memory.summary, 0, 4096) ||
          !optional_text(wire, memory.session_id, 0, 64) || !time(wire, memory.created_at) || !time(wire, memory.updated_at)) return invalid();
      memory.type = static_cast<AgentMemoryType>(type);
      page.memories.push_back(std::move(memory));
    }
    if (!wire.done()) return invalid();
    return Result<AgentMemoryPage>::success(std::move(page));
  }
  BindingRuntime runtime_;
  std::string binding_;
};
}  // namespace cf
