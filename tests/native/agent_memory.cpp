#include <cassert>
#include "cf/agent_memory.hpp"
#include "cf/task.hpp"

static void u32(cf::Bytes& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
static void text(cf::Bytes& bytes, const std::string& value) {
  u32(bytes, static_cast<std::uint32_t>(value.size())); bytes.insert(bytes.end(), value.begin(), value.end());
}
static void optional(cf::Bytes& bytes, const std::optional<std::string>& value) { u32(bytes, value ? 1 : 0); if (value) text(bytes, *value); }
static void timestamp(cf::Bytes& bytes, std::int64_t value) {
  const auto bits = std::bit_cast<std::uint64_t>(value);
  u32(bytes, static_cast<std::uint32_t>(bits)); u32(bytes, static_cast<std::uint32_t>(bits >> 32));
}
struct Row {
  std::string id = "owned";
  std::uint32_t type = 1;
  std::string summary = "summary";
  std::optional<std::string> session;
  std::int64_t created = -1;
  std::int64_t updated = 1;
};
static cf::Bytes page(const std::vector<Row>& rows = {Row{}}, const std::optional<std::string>& cursor = std::nullopt) {
  cf::Bytes bytes; u32(bytes, static_cast<std::uint32_t>(rows.size())); optional(bytes, cursor);
  for (const auto& row : rows) {
    text(bytes, row.id); u32(bytes, row.type); text(bytes, row.summary); optional(bytes, row.session);
    timestamp(bytes, row.created); timestamp(bytes, row.updated);
  }
  return bytes;
}
int main() {
  using namespace cf;
  int calls = 0;
  OperationCall observed{};
  OperationReply reply{ReplyKind::Value, page()};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call); done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  AgentMemory memory(runtime, "MEMORY");
  auto handler = [&]() -> Task {
    auto result = co_await memory.list_memories(GetOrCreateMemoryProfile{"owned-profile"});
    assert(result && result.value().memories.size() == 1 && !result.value().cursor);
    const auto& row = result.value().memories[0];
    assert(row.id == "owned" && row.type == AgentMemoryType::Event && row.summary == "summary" && !row.session_id);
    assert(row.created_at.time_since_epoch().count() == -1 && row.updated_at.time_since_epoch().count() == 1);
    assert(observed.method == Operation::AgentMemoryListCreatingProfile && observed.binding == "MEMORY");
    assert(observed.key == "owned-profile" && observed.body.empty() && observed.options == "20:5000");
    GetOrCreateMemoryProfile profile{"owned-profile"};
    AgentMemoryListOptions options;
    const std::string cursor = std::string("\xef\xbb\xbf猫") + '\0' + "owned";
    options.cursor = cursor;
    auto pending = memory.list_memories(profile, options);
    profile.name = "changed"; options.cursor = "changed"; options.limit = 1;
    assert(co_await pending);
    assert(observed.key == "owned-profile" && observed.body == Bytes(cursor.begin(), cursor.end()) && observed.options == "20:5000");
    const int baseline = calls;
    GetOrCreateMemoryProfile oversized_profile{std::string(1048576, 'p')};
    auto oversized = co_await memory.list_memories(oversized_profile);
    assert(!oversized && oversized.error().code == ErrorCode::InvalidInput);
    for (const auto& name : std::vector<std::string>{"", std::string(101, 'p'), "bad/name", "猫", "p\n"}) {
      auto bad = co_await memory.list_memories(GetOrCreateMemoryProfile{name});
      assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    for (auto input : std::vector<AgentMemoryListOptions>{{.limit = 0}, {.limit = 51}, {.cursor = ""},
        {.cursor = std::string(2049, 'c')}, {.cursor = "\xff"}, {.timeout = std::chrono::milliseconds(-1)},
        {.timeout = std::chrono::milliseconds(0)}, {.timeout = std::chrono::milliseconds(60001)}}) {
      auto bad = co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"}, input);
      assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == baseline);
    const auto good = page();
    for (std::size_t length = 0; length < good.size(); ++length) {
      reply.bytes.assign(good.begin(), good.begin() + length);
      auto bad = co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"});
      assert(!bad && bad.error().code == ErrorCode::HostFailure);
    }
    for (const auto& row : std::vector<Row>{{.id = ""}, {.id = std::string(129, 'i')}, {.id = "\xff"},
        {.type = 4}, {.summary = std::string(4097, 's')}, {.summary = "\xed\xa0\x80"},
        {.session = std::string(65, 's')}, {.session = "\xff"}, {.created = -8640000000000001LL},
        {.updated = 8640000000000001LL}}) {
      reply.bytes = page({row}); assert(!(co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"})));
    }
    for (auto bytes : std::vector<Bytes>{page({}, ""), page({}, std::string(2049, 'c')), page({}, "\xff"),
        page(std::vector<Row>(21)), Bytes(218261)}) {
      reply.bytes = std::move(bytes); assert(!(co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"})));
    }
    reply.bytes = good; reply.bytes[4] = 2;
    assert(!(co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"})));
    reply.bytes = good; reply.bytes[32] = 2;
    assert(!(co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"})));
    reply.bytes = good; reply.bytes.push_back(0);
    assert(!(co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"})));
    reply = {ReplyKind::Missing, good}; assert(!(co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"})));
    reply = {ReplyKind::Value, page({})};
    auto empty = co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"});
    assert(empty && empty.value().memories.empty() && !empty.value().cursor);
    Row max{.id = std::string(128, 'i'), .type = 3, .summary = std::string(4096, 's'), .session = std::string(64, 's'),
      .created = -8640000000000000LL, .updated = 8640000000000000LL};
    reply.bytes = page(std::vector<Row>(50, max), std::string(2048, 'c'));
    assert(reply.bytes.size() == 218260);
    auto maximum = co_await memory.list_memories(GetOrCreateMemoryProfile{std::string(100, 'p')},
      {.limit = 50, .cursor = std::string(2048, 'c'), .timeout = std::chrono::milliseconds(60000)});
    assert(maximum && maximum.value().memories.size() == 50 && maximum.value().cursor->size() == 2048);
    assert(maximum.value().memories[49].created_at.time_since_epoch().count() == -8640000000000000LL);
    assert(maximum.value().memories[49].updated_at.time_since_epoch().count() == 8640000000000000LL);
    assert(observed.options == "50:60000");
    for (std::uint32_t type = 0; type < 4; ++type) {
      const std::string summary = std::string("\xef\xbb\xbf猫") + '\0' + "owned";
      reply.bytes = page({Row{.type = type, .summary = summary, .session = ""}}, cursor);
      auto owned = co_await memory.list_memories(GetOrCreateMemoryProfile{"owned"}); reply.bytes.clear();
      assert(owned && owned.value().cursor == cursor && owned.value().memories[0].summary == summary);
      assert(owned.value().memories[0].session_id == "" && static_cast<std::uint32_t>(owned.value().memories[0].type) == type);
    }
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
