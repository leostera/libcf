#include "cf/vectorize.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.method == "GET" && request.path() == "/")
    co_return Response::text("bounded Vectorize query example");
  if (request.method != "POST" || (request.path() != "/query" && request.path() != "/short-timeout"))
    co_return Response::text("not found", 404);
  if (request.body.empty() || request.body.size() > 1536 * 4 || request.body.size() % 4 != 0)
    co_return Response::text("expected little-endian float32 dimensions", 400);
  VectorizeQuery input;
  Bytes body(request.body.begin(), request.body.end());
  detail::WireReader wire(body);
  while (!wire.done()) {
    std::uint32_t bits = 0;
    if (!wire.u32(bits)) co_return Response::text("invalid dimensions", 400);
    input.values.push_back(std::bit_cast<float>(bits));
  }
  if (request.path() == "/short-timeout") input.timeout = std::chrono::milliseconds(20);
  Vectorize index(context.bindings, "INDEX");
  auto result = co_await index.query(std::move(input));
  if (!result) co_return Response::text("Vectorize query failed", 502);
  std::string text;
  for (const auto& match : result.value()) text += match.id + "\t" + std::to_string(match.score) + "\n";
  co_return Response::text(std::move(text));
}
}  // namespace cf
