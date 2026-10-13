#include <string>

#include "cf/d1.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  D1Database database(context.bindings, "DB");
  const auto path = request.path();
  if (path == "/setup" && request.method == "POST") {
    auto result = co_await database.exec("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, value BLOB NOT NULL)");
    co_return result ? Response::text("ready") : Response::text("setup failed", 502);
  }
  if (path == "/constraint-probe" && request.method == "POST") {
    // Intentionally violate NOT NULL to demonstrate a rejected binding Promise
    // becoming a C++ Result, rather than terminating the Wasm instance.
    auto result = co_await database.prepare("INSERT INTO records(id,value) VALUES (?,?)")
        .bind({std::string("constraint-probe"), nullptr}).run();
    co_return result ? Response::text("unexpected success", 500) : Response::text("constraint rejected", 409);
  }
  if (!path.starts_with("/records/") || path.size() == 9)
    co_return Response::text("not found", 404);
  const std::string id(path.substr(9));
  if (request.method == "PUT") {
    auto result = co_await database.prepare("INSERT INTO records(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value")
        .bind({id, Bytes(request.body.begin(), request.body.end())}).run();
    co_return result ? Response::text("stored", 201) : Response::text("write failed", 502);
  }
  if (request.method == "GET") {
    auto result = co_await database.prepare("SELECT value FROM records WHERE id=?").bind({id}).all();
    if (!result) co_return Response::text("query failed", 502);
    if (result.value().rows.empty()) co_return Response::text("not found", 404);
    const auto& cell = result.value().rows.front().at("value");
    const auto* bytes = std::get_if<Bytes>(&cell);
    if (!bytes) co_return Response::text("unexpected database value type", 502);
    Response response;
    response.headers.append("content-type", "application/octet-stream");
    response.body = std::string(bytes->begin(), bytes->end());
    co_return response;
  }
  if (request.method == "DELETE") {
    auto result = co_await database.prepare("DELETE FROM records WHERE id=?").bind({id}).run();
    co_return result ? Response::text("deleted") : Response::text("delete failed", 502);
  }
  co_return Response::text("method not allowed", 405);
}
}  // namespace cf
