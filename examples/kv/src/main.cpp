#include <charconv>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "cf/kv.hpp"
#include "cf/worker.hpp"

namespace {
std::string json_quote(std::string_view value) {
  constexpr char hex[] = "0123456789abcdef";
  std::string result = "\"";
  for (unsigned char byte : value) {
    if (byte == '"' || byte == '\\') {
      result += '\\';
      result += static_cast<char>(byte);
    } else if (byte < 0x20) {
      result += "\\u00";
      result += hex[byte >> 4];
      result += hex[byte & 0x0f];
    } else {
      result += static_cast<char>(byte);
    }
  }
  return result + '"';
}

cf::Response json(std::string body) {
  cf::Response response;
  response.body = std::move(body);
  response.headers.append("content-type", "application/json; charset=utf-8");
  return response;
}

std::string_view after(std::string_view path, std::string_view prefix) {
  return path.starts_with(prefix) ? path.substr(prefix.size()) : std::string_view{};
}
}

namespace cf {

Task handle(Request request, WorkerContext context) {
  KvNamespace kv(context.bindings, "DEMO_KV");
  const auto path = request.path();
  if (path == "/list") {
    std::string cursor;
    std::string output = "{\"keys\":[";
    unsigned pages = 0;
    while (pages++ < 1000) {
      auto page = co_await kv.list("item:", cursor, 1);
      if (!page) co_return Response::text("list failed: " + page.error().message, 502);
      for (const auto& key : page.value().keys) {
        if (output.back() != '[') output += ',';
        output += json_quote(key.name);
      }
      if (!page.value().next_cursor) {
        output += "]}";
        co_return json(std::move(output));
      }
      cursor = *page.value().next_cursor;
    }
    co_return Response::text("too many list pages", 502);
  }

  if (path.starts_with("/metadata/")) {
    const auto key = after(path, "/metadata/");
    if (request.method != "GET" || key.empty()) co_return Response::text("invalid metadata request", 400);
    auto result = co_await kv.get_with_metadata(std::string(key));
    if (!result) co_return Response::text("metadata failed: " + result.error().message, 502);
    if (!result.value()) co_return Response::text("not found", 404);
    const auto& entry = *result.value();
    const std::string text(entry.value.begin(), entry.value.end());
    co_return json("{\"value\":" + json_quote(text) + ",\"metadata\":" +
                   entry.metadata_json.value_or("null") + "}");
  }

  if (path.starts_with("/bytes/")) {
    const auto key = after(path, "/bytes/");
    if (key.empty()) co_return Response::text("missing key", 400);
    if (request.method == "PUT") {
      auto result = co_await kv.put(std::string(key), Bytes(request.body.begin(), request.body.end()));
      co_return result ? Response::text("stored", 201) : Response::text("put failed: " + result.error().message, 502);
    }
    if (request.method == "GET") {
      auto result = co_await kv.get_bytes(std::string(key));
      if (!result) co_return Response::text("read failed: " + result.error().message, 502);
      if (!result.value()) co_return Response::text("not found", 404);
      Response response;
      response.body = std::string(result.value()->begin(), result.value()->end());
      response.headers.append("content-type", "application/octet-stream");
      co_return response;
    }
    co_return Response::text("method not allowed", 405);
  }

  if (path.starts_with("/items/")) {
    const auto key = after(path, "/items/");
    if (key.empty()) co_return Response::text("missing key", 400);
    if (request.method == "GET") {
      auto result = co_await kv.get_text(std::string(key));
      if (!result) co_return Response::text("read failed: " + result.error().message, 502);
      co_return result.value() ? Response::text(*result.value()) : Response::text("not found", 404);
    }
    if (request.method == "PUT") {
      KvPutOptions options;
      if (auto ttl = request.headers.get("x-ttl")) {
        std::uint32_t seconds = 0;
        const auto [end, error] = std::from_chars(ttl->data(), ttl->data() + ttl->size(), seconds);
        if (error != std::errc{} || end != ttl->data() + ttl->size())
          co_return Response::text("invalid TTL", 400);
        options.expiration_ttl = seconds;
      }
      if (auto metadata = request.headers.get("x-metadata"))
        options.metadata_json = std::string(*metadata);
      auto result = co_await kv.put_text(std::string(key), request.body, std::move(options));
      co_return result ? Response::text("stored", 201) : Response::text("put failed: " + result.error().message, 502);
    }
    if (request.method == "DELETE") {
      auto result = co_await kv.erase(std::string(key));
      co_return result ? Response::text("deleted") : Response::text("delete failed: " + result.error().message, 502);
    }
    co_return Response::text("method not allowed", 405);
  }
  co_return Response::text("not found", 404);
}

}  // namespace cf
