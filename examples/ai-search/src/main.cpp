#include "cf/ai_search.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.method == "GET" && request.path() == "/")
    co_return Response::text("bounded AI Search keyword example");
  if (request.method != "POST" || (request.path() != "/search" && request.path() != "/short-timeout"))
    co_return Response::text("not found", 404);
  AiSearchKeywordQuery query{std::move(request.body)};
  if (request.path() == "/short-timeout") query.timeout = std::chrono::milliseconds(20);
  AiSearch search(context.bindings, "SEARCH");
  auto result = co_await search.keyword_search(query);
  if (!result) co_return Response::text("AI Search query failed", 502);
  // Human-readable demonstration, not a delimiter-safe serialization format.
  std::string text;
  for (const auto& match : result.value())
    text += match.id + "\t" + std::to_string(match.score) + "\t" + match.source_key + "\t" + match.text + "\n";
  co_return Response::text(std::move(text));
}
}  // namespace cf
