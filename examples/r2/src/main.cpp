#include <charconv>
#include <string>

#include "cf/r2.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  R2Bucket bucket(context.bindings, "BUCKET");
  const auto path = request.path();
  if (path == "/list" && request.method == "GET") {
    std::string cursor, output;
    for (unsigned page_number = 0; page_number < 1000; ++page_number) {
      auto page = co_await bucket.list("listed-", cursor, 1);
      if (!page) co_return Response::text("list failed", 502);
      for (const auto& object : page.value().objects) output += object.key + "\n";
      if (!page.value().next_cursor) co_return Response::text(std::move(output));
      cursor = *page.value().next_cursor;
    }
    co_return Response::text("list page limit exceeded", 502);
  }
  if (!path.starts_with("/objects/") || path.size() == 9) co_return Response::text("not found", 404);
  const std::string key(path.substr(9));
  if (request.method == "PUT") {
    auto result = co_await bucket.put(key, Bytes(request.body.begin(), request.body.end()),
        std::string(request.headers.get("content-type").value_or("application/octet-stream")));
    if (!result) co_return Response::text("put failed", 502);
    auto response = Response::text("stored", 201);
    response.headers.append("etag", result.value().http_etag);
    co_return response;
  }
  if (request.method == "GET") {
    std::optional<R2Range> range;
    if (const auto offset = request.headers.get("x-offset")) {
      std::uint64_t start = 0;
      const auto [end, error] = std::from_chars(offset->data(), offset->data() + offset->size(), start);
      if (error != std::errc{} || end != offset->data() + offset->size())
        co_return Response::text("invalid offset", 400);
      range = R2Range{start, 2};
    }
    auto result = co_await bucket.get(key, range);
    if (!result) co_return Response::text("get failed", 502);
    if (!result.value()) co_return Response::text("not found", 404);
    auto& object = *result.value();
    Response response;
    response.body = std::string(object.body.begin(), object.body.end());
    response.headers.append("content-type", object.object.content_type);
    response.headers.append("etag", object.object.http_etag);
    co_return response;
  }
  if (request.method == "HEAD") {
    auto result = co_await bucket.head(key);
    Response response;
    if (!result) response.status = 502;
    else if (!result.value()) response.status = 404;
    else {
      response.headers.append("x-object-size", std::to_string(result.value()->size));
      response.headers.append("etag", result.value()->http_etag);
    }
    co_return response;
  }
  if (request.method == "DELETE") {
    auto result = co_await bucket.erase(key);
    co_return result ? Response::text("deleted") : Response::text("delete failed", 502);
  }
  co_return Response::text("method not allowed", 405);
}
}  // namespace cf
