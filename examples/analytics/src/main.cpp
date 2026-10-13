#include "cf/analytics.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  if (request.method != "POST" || (request.path() != "/write" && request.path() != "/missing"))
    co_return Response::text("not found", 404);
  AnalyticsEngine dataset(context.bindings, request.path() == "/missing" ? "MISSING" : "DATASET");
  AnalyticsDataPoint point;
  point.blobs = {std::string("libcf"), Bytes{0, 255, 65}, nullptr};
  point.doubles = {2.5, -3.0};
  point.index = std::move(request.body);
  auto accepted = co_await dataset.write(std::move(point));
  co_return accepted ? Response::text("accepted; not a persistence receipt", 202) : Response::text("write failed", 502);
}
}  // namespace cf
