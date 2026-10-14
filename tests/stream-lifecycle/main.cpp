#include <cstdint>
#include <memory>
#include "cf/worker.hpp"

static_assert(__cplusplus >= 202302L, "This probe must actually compile as C++23");
namespace {
constexpr std::size_t chunk_bytes = 65536;
constexpr std::size_t chunk_count = 128;  // At most 8 MiB per owned local stream.
// Synthetic test metrics only; no request data or I/O object is shared globally.
std::uint64_t pulls = 0, chunks = 0, released = 0, active = 0, sessions = 0;
struct Source {
  Source() { ++active; }
  ~Source() { --active; ++released; }
  Source(const Source&) = delete;
  Source& operator=(const Source&) = delete;
};
}
namespace cf {
Task handle(Request request, WorkerContext) {
  if (request.path() == "/stats")
    co_return Response::text(std::to_string(__cplusplus) + " " + std::to_string(pulls) + " " +
        std::to_string(chunks) + " " + std::to_string(released) + " " +
        std::to_string(active) + " " + std::to_string(sessions));
  if (request.path() != "/stream") co_return Response::text("not found", 404);
  if (active) co_return Response::text("one probe stream at a time", 409);
  pulls = 0; chunks = 0; ++sessions;
  // The source owns its capture after the request coroutine has returned.
  auto source = std::make_shared<Source>();
  auto response = Response::streaming([source = std::move(source)]() -> std::optional<std::string> {
    ++pulls;
    if (chunks == chunk_count) return std::nullopt;
    const auto byte = static_cast<char>(chunks % 251); ++chunks;
    return std::string(chunk_bytes, byte);
  });
  response.headers = Headers{};
  response.headers.append("content-type", "application/octet-stream");
  co_return response;
}
}
