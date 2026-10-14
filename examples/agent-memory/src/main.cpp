#include "cf/agent_memory.hpp"
#include "cf/worker.hpp"
namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Agent Memory example; listing may create a profile");
  if (request.method != "POST" || (path != "/list" && path != "/missing" &&
      path != "/invalid-profile" && path != "/short-timeout" && path != "/maximum"))
    co_return Response::text("not found", 404);
  AgentMemory memory(context.bindings, path == "/missing" ? "MISSING" : "MEMORY");
  AgentMemoryListOptions options;
  if (!request.body.empty()) options.cursor = std::move(request.body);
  if (path == "/short-timeout") options.timeout = std::chrono::milliseconds(5);
  if (path == "/maximum") options.limit = 50;
  GetOrCreateMemoryProfile profile{path == "/invalid-profile" ? "bad/name" : "libcf-owned-example"};
  auto result = co_await memory.list_memories(std::move(profile), options);
  if (!result) co_return Response::text("Agent Memory list failed", 502);
  auto& page = result.value();
  std::string output = "count=" + std::to_string(page.memories.size()) + "\ncursor=" + page.cursor.value_or("<none>") + "\n";
  for (const auto& record : page.memories) {
    output += record.id + "\t" + std::to_string(static_cast<std::uint32_t>(record.type)) + "\t" + record.summary + "\t";
    output += record.session_id ? "value:" + *record.session_id : "null";
    output += "\t" + std::to_string(record.created_at.time_since_epoch().count()) + "\t" +
      std::to_string(record.updated_at.time_since_epoch().count()) + "\n";
  }
  // Human-readable demonstration only, not delimiter-safe interchange.
  co_return Response::text(std::move(output));
}
}  // namespace cf
