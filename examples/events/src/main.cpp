#include "cf/d1.hpp"
#include "cf/events.hpp"
#include "cf/queue.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  auto event = worker_event(context.env);
  if (!event) co_return Response::text("invalid event", 500);
  D1Database database(context.bindings, "DB");
  auto setup = co_await database.exec(
      "CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,payload BLOB NOT NULL,attempts INTEGER NOT NULL,format TEXT NOT NULL);\n"
      "CREATE TABLE IF NOT EXISTS schedules(id INTEGER PRIMARY KEY,cron TEXT NOT NULL,time TEXT NOT NULL);");
  if (!setup) co_return Response::text("setup failed", 500);
  if (event.value() == WorkerEvent::Queue) {
    auto parsed = queue_message(context.env, std::move(request));
    if (!parsed) co_return queue_retry();
    auto& message = parsed.value();
    const auto* text = std::get_if<std::string>(&message.body);
    if (text && text->starts_with("retry:") && message.attempts == 1) co_return queue_retry();
    Bytes payload = text ? Bytes(text->begin(), text->end()) : std::move(std::get<Bytes>(message.body));
    auto statement = database.prepare("INSERT OR IGNORE INTO messages VALUES (?,?,?,?)")
        .bind({message.id, std::move(payload), static_cast<std::int64_t>(message.attempts), std::string(text ? "text" : "bytes")});
    auto stored = co_await statement.run();
    co_return stored ? queue_ack() : queue_retry();
  }
  if (event.value() == WorkerEvent::Scheduled) {
    auto scheduled = scheduled_event(context.env);
    if (!scheduled || scheduled.value().cron == "fail-for-test") co_return Response::text("scheduled failure", 500);
    auto statement = database.prepare("INSERT OR REPLACE INTO schedules VALUES (1,?,?)")
        .bind({scheduled.value().cron, std::to_string(scheduled.value().scheduled_time.time_since_epoch().count())});
    auto stored = co_await statement.run();
    co_return stored ? Response::text("scheduled") : Response::text("scheduled write failed", 500);
  }
  const auto path = request.path();
  if (request.method == "POST" && (path == "/send/text" || path == "/send/bytes")) {
    Queue queue(context.bindings, "EVENTS");
    auto sent = co_await (path == "/send/text" ? queue.send_text(std::move(request.body))
        : queue.send_bytes(Bytes(request.body.begin(), request.body.end())));
    co_return sent ? Response::text("queued", 202) : Response::text("send failed", 502);
  }
  if (path == "/lookup" && request.method == "POST") {
    auto statement = database.prepare("SELECT payload,attempts,format FROM messages WHERE payload=?")
        .bind({Bytes(request.body.begin(), request.body.end())});
    auto found = co_await statement.first();
    if (!found) co_return Response::text("lookup failed", 500);
    if (!found.value()) co_return Response::text("pending", 404);
    auto& row = *found.value();
    auto& bytes = std::get<Bytes>(row.at("payload"));
    Response response = Response::text(std::string(bytes.begin(), bytes.end()));
    response.headers.append("x-attempts", std::to_string(static_cast<int>(std::get<double>(row.at("attempts")))));
    response.headers.append("x-body-format", std::get<std::string>(row.at("format")));
    co_return response;
  }
  if (path == "/scheduled-status") {
    auto row = co_await database.prepare("SELECT cron,time FROM schedules WHERE id=1").first();
    if (!row) co_return Response::text("lookup failed", 500);
    if (!row.value()) co_return Response::text("pending", 404);
    auto response = Response::text(std::get<std::string>(row.value()->at("cron")));
    response.headers.append("x-scheduled-time", std::get<std::string>(row.value()->at("time")));
    co_return response;
  }
  co_return Response::text("not found", 404);
}
}  // namespace cf
