#include <cassert>
#include <map>
#include "cf/websocket.hpp"

int main() {
  using namespace cf;
  std::map<std::string, std::string> fields{
      {"__LIBCF_DO_EVENT", "websocket"}, {"__LIBCF_WS_KIND", "message"},
      {"__LIBCF_WS_FORMAT", "bytes"}};
  Env env([&](std::string_view key) -> std::optional<std::string> {
    const auto it = fields.find(std::string(key));
    return it == fields.end() ? std::nullopt : std::optional(it->second);
  });
  Request request{"POST", "https://example.test", {}, std::string("a\0b", 3)};
  auto message = websocket_event(env, request);
  assert(message);
  assert(std::get<Bytes>(std::get<WebSocketMessage>(message.value()).body) == (Bytes{'a', 0, 'b'}));
  fields["__LIBCF_WS_KIND"] = "close";
  fields["__LIBCF_WS_CODE"] = "1006";
  fields["__LIBCF_WS_CLEAN"] = "0";
  auto close = websocket_event(env, request);
  assert(close && std::get<WebSocketClose>(close.value()).code == 1006);
  assert(!std::get<WebSocketClose>(close.value()).was_clean);
  fields["__LIBCF_WS_CODE"] = "65536";
  assert(!websocket_event(env, request));
  fields["__LIBCF_WS_KIND"] = "error";
  assert(websocket_event(env, request));
  fields["__LIBCF_DO_EVENT"] = "fetch";
  assert(!websocket_event(env, request));
  assert(websocket_accept().headers.get("x-libcf-ws-action") == "accept");
  assert(websocket_close(1000, "bye").status == 200);
  assert(websocket_close(1006).status == 500);
  assert(websocket_close(3000, std::string(124, 'x')).status == 500);
}
