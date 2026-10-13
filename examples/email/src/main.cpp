#include "cf/d1.hpp"
#include "cf/email.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  D1Database database(context.bindings, "DB");
  auto setup = co_await database.exec("CREATE TABLE IF NOT EXISTS emails(id TEXT PRIMARY KEY,payload BLOB NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL)");
  if (!setup) co_return Response::text("setup failed", 500);
  if (context.env.var("__LIBCF_EMAIL_EVENT") == "email") {
    auto parsed = email_message(context.env, std::move(request));
    if (!parsed) co_return Response::text("invalid email", 500);
    auto& message = parsed.value();
    if (message.to == "reject@example.test") co_return email_reject("blocked by C++ example");
    if (message.to == "forward@example.test") co_return email_forward(context.env.var("FORWARD_TO").value_or(""));
    if (message.headers.get("subject") == "fail") co_return Response::text("deliberate failure", 500);
    if (message.headers.get("subject") == "no-disposition") co_return Response{};
    auto id = message.headers.get("message-id");
    if (!id || id->empty()) co_return email_reject("Message-ID required by this example");
    auto statement = database.prepare("INSERT OR IGNORE INTO emails VALUES (?,?,?,?)")
        .bind({std::string(*id), std::move(message.raw), message.from, message.to});
    auto stored = co_await statement.run();
    co_return stored ? email_consume() : Response::text("storage failure", 500);
  }
  if (request.path() == "/lookup" && request.method == "POST") {
    auto statement = database.prepare("SELECT payload,sender,recipient FROM emails WHERE id=?").bind({request.body});
    auto row = co_await statement.first();
    if (!row) co_return Response::text("lookup failed", 500);
    if (!row.value()) co_return Response::text("missing", 404);
    const auto& bytes = std::get<Bytes>(row.value()->at("payload"));
    auto response = Response::text(std::string(bytes.begin(), bytes.end()));
    response.headers.append("x-envelope-from", std::get<std::string>(row.value()->at("sender")));
    response.headers.append("x-envelope-to", std::get<std::string>(row.value()->at("recipient")));
    co_return response;
  }
  co_return Response::text("not found", 404);
}
}  // namespace cf
