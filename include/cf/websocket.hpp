#pragma once

#include <charconv>
#include <variant>

#include "cf/env.hpp"
#include "cf/http.hpp"
#include "cf/operation.hpp"

namespace cf {
struct WebSocketMessage {
  std::variant<std::string, Bytes> body;
};
struct WebSocketClose {
  std::uint16_t code;
  std::string reason;
  bool was_clean;
};
struct WebSocketError {};
using WebSocketEvent = std::variant<WebSocketMessage, WebSocketClose, WebSocketError>;

inline Result<WebSocketEvent> websocket_event(const Env& env, Request request) {
  const auto invalid = [] {
    return Result<WebSocketEvent>::failure(
        {ErrorCode::InvalidInput, "invalid WebSocket event metadata"});
  };
  if (env.var("__LIBCF_DO_EVENT") != "websocket") return invalid();
  const auto kind = env.var("__LIBCF_WS_KIND");
  if (kind == "message") {
    if (request.body.size() > 1024 * 1024) return invalid();
    const auto format = env.var("__LIBCF_WS_FORMAT");
    if (format == "text")
      return Result<WebSocketEvent>::success(WebSocketMessage{std::move(request.body)});
    if (format == "bytes")
      return Result<WebSocketEvent>::success(
          WebSocketMessage{Bytes(request.body.begin(), request.body.end())});
  }
  if (kind == "close") {
    const auto code = env.var("__LIBCF_WS_CODE");
    const auto clean = env.var("__LIBCF_WS_CLEAN");
    if (!code || (clean != "0" && clean != "1")) return invalid();
    std::uint16_t parsed = 0;
    const auto [end, error] = std::from_chars(code->data(), code->data() + code->size(), parsed);
    if (error != std::errc{} || end != code->data() + code->size() || parsed < 1000 ||
        parsed > 4999)
      return invalid();
    return Result<WebSocketEvent>::success(
        WebSocketClose{parsed, std::move(request.body), clean == "1"});
  }
  if (kind == "error") return Result<WebSocketEvent>::success(WebSocketError{});
  return invalid();
}

// These responses are commands consumed by createDurableObject, not HTTP 101
// responses constructed inside Wasm. Native socket ownership stays in JS.
inline Response websocket_accept() {
  Response response;
  response.headers.append("x-libcf-ws-action", "accept");
  return response;
}
inline Response websocket_ignore() {
  Response response;
  response.headers.append("x-libcf-ws-action", "ignore");
  return response;
}
inline Response websocket_send_text(std::string text) {
  if (text.size() > 1024 * 1024) return Response::text("WebSocket frame exceeds limit", 500);
  auto response = Response::text(std::move(text));
  response.headers.append("x-libcf-ws-action", "send");
  response.headers.append("x-libcf-ws-format", "text");
  return response;
}
inline Response websocket_send_bytes(Bytes bytes) {
  if (bytes.size() > 1024 * 1024) return Response::text("WebSocket frame exceeds limit", 500);
  auto response = Response::text(std::string(bytes.begin(), bytes.end()));
  response.headers.append("x-libcf-ws-action", "send");
  response.headers.append("x-libcf-ws-format", "bytes");
  return response;
}
inline Response websocket_close(std::uint16_t code = 1000, std::string reason = {}) {
  const bool standard = code == 1000 || code == 1001 || code == 1002 || code == 1003 ||
                        (code >= 1007 && code <= 1014);
  if ((!standard && (code < 3000 || code > 4999)) || reason.size() > 123)
    return Response::text("invalid WebSocket close", 500);
  auto response = Response::text(std::move(reason));
  response.headers.append("x-libcf-ws-action", "close");
  response.headers.append("x-libcf-ws-code", std::to_string(code));
  return response;
}
}  // namespace cf
