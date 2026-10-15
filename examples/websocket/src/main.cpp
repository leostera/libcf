#include "cf/durable_storage.hpp"
#include "cf/websocket.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  DurableStorage storage(context.bindings);
  if (context.env.var("__LIBCF_DO_EVENT") == "websocket") {
    auto parsed = websocket_event(context.env, std::move(request));
    if (!parsed) co_return Response::text("invalid socket event", 500);
    if (auto* message = std::get_if<WebSocketMessage>(&parsed.value())) {
      auto counted = co_await storage.sql({"UPDATE state SET messages=messages+1"});
      if (!counted) co_return Response::text("storage failure", 500);
      if (auto* text = std::get_if<std::string>(&message->body)) {
        if (*text == "close") co_return websocket_close(1000, "bye");
        if (*text == "fail") co_return Response::text("deliberate failure", 500);
        co_return websocket_send_text(std::move(*text));
      }
      co_return websocket_send_bytes(std::move(std::get<Bytes>(message->body)));
    }
    if (auto* close = std::get_if<WebSocketClose>(&parsed.value())) {
      SqlCommand command{"UPDATE state SET closes=closes+1,last_code=?",
                         {static_cast<std::int64_t>(close->code)}};
      auto counted = co_await storage.sql(std::move(command));
      if (!counted) co_return Response::text("close storage failure", 500);
    }
    co_return websocket_ignore();
  }
  auto event = durable_event(context.env);
  if (!event) co_return Response::text("invalid object event", 500);
  if (event.value() == DurableEvent::Initialize) {
    std::vector<SqlCommand> commands{
        {"CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY,messages INTEGER NOT NULL,closes "
         "INTEGER NOT NULL,last_code INTEGER NOT NULL,initializations INTEGER NOT NULL)"},
        {"INSERT OR IGNORE INTO state VALUES (1,0,0,0,0)"},
        {"UPDATE state SET initializations=initializations+1"},
    };
    auto initialized = co_await storage.transaction(std::move(commands));
    co_return initialized ? Response::text("initialized")
                          : Response::text("initialization failed", 500);
  }
  if (request.path().ends_with("/connect")) co_return websocket_accept();
  if (request.path().ends_with("/deny")) co_return Response::text("upgrade denied by C++", 403);
  if (request.path().ends_with("/stats")) {
    auto rows =
        co_await storage.sql({"SELECT messages,closes,last_code,initializations FROM state"});
    if (!rows || rows.value().rows.empty()) co_return Response::text("storage failure", 500);
    auto& row = rows.value().rows.front();
    auto response =
        Response::text(std::to_string(static_cast<int>(std::get<double>(row.at("messages")))));
    response.headers.append("x-closes",
                            std::to_string(static_cast<int>(std::get<double>(row.at("closes")))));
    response.headers.append(
        "x-initializations",
        std::to_string(static_cast<int>(std::get<double>(row.at("initializations")))));
    response.headers.append(
        "x-last-code", std::to_string(static_cast<int>(std::get<double>(row.at("last_code")))));
    co_return response;
  }
  co_return Response::text("not found", 404);
}
}  // namespace cf
