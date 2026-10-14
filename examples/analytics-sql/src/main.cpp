#include "cf/analytics_sql.hpp"
#include "cf/worker.hpp"
namespace cf {
static std::optional<std::string> display(const AnalyticsSqlScalar& value) {
  if (std::holds_alternative<std::nullptr_t>(value)) return "null";
  if (const auto* boolean = std::get_if<bool>(&value)) return *boolean ? "true" : "false";
  if (const auto* text = std::get_if<std::string>(&value)) return *text;
  char buffer[64];
  const auto [end, error] = std::to_chars(buffer, buffer + sizeof(buffer), std::get<double>(value), std::chars_format::general);
  if (error != std::errc{}) return std::nullopt;
  return std::string(buffer, end);
}
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (request.method == "GET" && path == "/") co_return Response::text("Analytics SQL scalar projection; explicit mock fixture only");
  if (request.method != "POST" || (path != "/query" && path != "/positional" && path != "/missing" && path != "/short-timeout"))
    co_return Response::text("not found", 404);
  if (request.body.size() > 4096) co_return Response::text("Analytics SQL failed", 502);
  const std::string label = request.body.empty() ? "synthetic-猫" : request.body;
  // Illustrative SQL only: native use needs an approved owned dataset/schema,
  // access policy, time window and independent scan budget. Never accept raw SQL.
  AnalyticsSqlQuery query{"SELECT value FROM synthetic WHERE timestamp >= $start AND label = $label LIMIT 1",
    AnalyticsSqlNamedParameters{{"start", std::string("2026-10-14T00:00:00Z")}, {"label", label}}};
  if (path == "/positional") {
    query.statement = "SELECT ? AS empty, ? AS disabled, ? AS enabled, ? AS zero, ? AS fraction, ? AS label FROM synthetic WHERE timestamp >= '2026-10-14T00:00:00Z' LIMIT 1";
    query.parameters = AnalyticsSqlPositionalParameters{nullptr, false, true, -0.0, 0.25, label};
  }
  AnalyticsSql sql(context.bindings, path == "/missing" ? "MISSING" : "ANALYTICS");
  AnalyticsSqlOptions options;
  if (path == "/short-timeout") options.timeout = std::chrono::milliseconds(5);
  auto result = co_await sql.query(query, options);
  if (!result) co_return Response::text("Analytics SQL failed", 502);
  std::string body;
  for (const auto& row : result.value().rows) {
    for (const auto& column : row) {
      const auto value = display(column.value);
      if (!value) co_return Response::text("Analytics SQL failed", 502);
      body += column.name + "=" + *value + "\n";
    }
    body += "\n";
  }
  const auto& stats = result.value().statistics;
  const auto elapsed = display(stats.elapsed.count());
  if (!elapsed) co_return Response::text("Analytics SQL failed", 502);
  body += "elapsed_ms=" + *elapsed + "\nrows_read=" + std::to_string(stats.rows_read) + "\nbytes_read=" + std::to_string(stats.bytes_read) + "\n";
  // Display only: names/values may contain delimiters, NUL or terminal controls.
  co_return Response::text(body);
}
}  // namespace cf
