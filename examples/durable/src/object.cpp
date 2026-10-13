#include <chrono>
#include "cf/durable_storage.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  auto event = durable_event(context.env);
  if (!event) co_return Response::text("invalid object context", 500);
  DurableStorage storage(context.bindings);
  static int initializations = 0; // Per-object Wasm memory, not durable data.
  if (event.value() == DurableEvent::Initialize) {
    ++initializations;
    std::vector<SqlCommand> setup;
    setup.push_back({"CREATE TABLE IF NOT EXISTS counter(id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL, pending INTEGER NOT NULL, alarm_hits INTEGER NOT NULL)", {}});
    setup.push_back({"INSERT OR IGNORE INTO counter VALUES (1,0,0,0)", {}});
    auto result = co_await storage.transaction(std::move(setup));
    co_return result ? Response::text("initialized") : Response::text("initialization failed", 500);
  }
  if (event.value() == DurableEvent::Alarm) {
    // At-least-once delivery: only an armed alarm changes durable state.
    SqlCommand command{"UPDATE counter SET alarm_hits=alarm_hits+1,pending=0 WHERE id=1 AND pending=1", {}};
    auto result = co_await storage.sql(std::move(command));
    co_return result ? Response::text("alarmed") : Response::text("alarm failed", 500);
  }
  const auto path = request.path();
  if (path == "/initializations") co_return Response::text(std::to_string(initializations));
  if (path == "/sql-echo" && request.method == "POST") {
    SqlCommand command{"SELECT ? AS value", {Bytes(request.body.begin(), request.body.end())}};
    auto result = co_await storage.sql(std::move(command));
    if (!result) co_return Response::text("SQL echo failed", 500);
    const auto& bytes = std::get<Bytes>(result.value().rows.front().at("value"));
    co_return Response::text(std::string(bytes.begin(), bytes.end()));
  }
  if (path == "/echo" && request.method == "POST") {
    auto response = Response::text(std::move(request.body), 201);
    response.headers.append("x-object-header", std::string(request.headers.get("x-original").value_or("absent")));
    co_return response;
  }
  if (path == "/rollback" && request.method == "POST") {
    std::vector<SqlCommand> commands;
    commands.push_back({"UPDATE counter SET value=value+100 WHERE id=1", {}});
    commands.push_back({"INSERT INTO counter VALUES (2,NULL,0,0)", {}});
    auto result = co_await storage.transaction(std::move(commands));
    co_return result ? Response::text("unexpected commit", 500) : Response::text("rolled back", 409);
  }
  if (path == "/schedule" && request.method == "POST") {
    SqlCommand command{"UPDATE counter SET pending=1 WHERE id=1", {}};
    auto armed = co_await storage.sql(std::move(command));
    if (!armed) co_return Response::text("arming failed", 500);
    auto scheduled = co_await storage.setAlarm(std::chrono::system_clock::now() + std::chrono::milliseconds(50));
    co_return scheduled ? Response::text("scheduled", 202) : Response::text("scheduling failed", 500);
  }
  SqlCommand command;
  if (path == "/increment" && request.method == "POST")
    command.sql = "UPDATE counter SET value=value+1 WHERE id=1 RETURNING value";
  else if (path == "/value" && request.method == "GET")
    command.sql = "SELECT value FROM counter WHERE id=1";
  else if (path == "/alarm-count" && request.method == "GET")
    command.sql = "SELECT alarm_hits AS value FROM counter WHERE id=1";
  else co_return Response::text("not found", 404);
  auto result = co_await storage.sql(std::move(command));
  if (!result || result.value().rows.size() != 1) co_return Response::text("SQL failed", 500);
  const double value = std::get<double>(result.value().rows.front().at("value"));
  Response response;
  response.body = "{\"value\":" + std::to_string(value) + "}";
  response.headers.append("content-type", "application/json");
  co_return response;
}
}  // namespace cf
