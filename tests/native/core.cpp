#include <cassert>
#include <string>

#include "libcf/http.hpp"
#include "libcf/router.hpp"
#include "libcf/env.hpp"
#include "libcf/crypto.hpp"
#include "libcf/detail/header_wire.hpp"
#include "libcf/fetch.hpp"
#include "libcf/task.hpp"

int main() {
  libcf::Headers headers;
  headers.append("Content-Type", "text/plain");
  headers.append("content-type", "text/other");
  assert(headers.get("CONTENT-TYPE") == "text/plain");
  assert(headers.fields().size() == 2);
  assert(!headers.get("missing"));

  const std::uint8_t encoded[] = {4, 0, 0, 0, 5, 0, 0, 0,
                                  'x', '-', 'i', 'd', 'h', 'e', 'l', 'l', 'o'};
  auto parsed = libcf::detail::parse_headers(encoded);
  assert(parsed && parsed->get("X-ID") == "hello");
  assert(!libcf::detail::parse_headers(std::span(encoded, 2)));
  const std::uint8_t zero_name[] = {0, 0, 0, 0, 0, 0, 0, 0};
  assert(!libcf::detail::parse_headers(zero_name));

  libcf::Crypto crypto([](std::span<std::uint8_t> bytes) {
    for (auto& byte : bytes) byte = 0;
  });
  const auto uuid = crypto.random_uuid();
  assert(uuid.size() == 36 && uuid[14] == '4' && uuid[19] == '8');
  assert(crypto.random_bytes(16).size() == 16);
  bool rejected = false;
  try { (void)crypto.random_bytes(65537); } catch (const std::length_error&) { rejected = true; }
  assert(rejected);

  libcf::Env env([](std::string_view name) -> std::optional<std::string> {
    return name == "TEST" ? std::optional<std::string>("value") : std::nullopt;
  });
  assert(env.var("TEST") == "value");
  assert(!env.var("NOT_SET"));
  assert(!env.var(""));

  libcf::Request request{"GET", "https://example.test/users/Alice?verbose=1", {}, ""};
  assert(request.path() == "/users/Alice");
  request.url = "https://example.test";
  assert(request.path() == "/");

  libcf::Router router;
  assert(router.route("GET", "/users/:name", [](const auto&, const auto& params) {
    return libcf::Response::text(std::string(params.get("name")));
  }));
  assert(router.route("GET", "/users/me", [](const auto&, const auto&) {
    return libcf::Response::text("static");
  }));
  assert(!router.route("GET", "/users/me", [](const auto&, const auto&) {
    return libcf::Response::text("duplicate");
  }));
  assert(!router.route("GET", "/users/:", [](const auto&, const auto&) {
    return libcf::Response::text("invalid");
  }));

  request.url = "https://example.test/users/me";
  assert(router.dispatch(request).body == "static");
  request.url = "https://example.test/users/Alice";
  assert(router.dispatch(request).body == "Alice");
  request.method = "POST";
  assert(router.dispatch(request).status == 405);
  request.url = "https://example.test/missing";
  assert(router.dispatch(request).status == 404);

  libcf::Fetcher::Completion complete;
  libcf::Fetcher fetcher(
      [&](std::string url, auto callback) {
        assert(url == "https://example.test/asset");
        complete = std::move(callback);
      },
      [](std::coroutine_handle<> handle) { handle.resume(); });
  auto handler = [&]() -> libcf::Task {
    auto result = co_await fetcher.get("https://example.test/asset");
    co_return libcf::Response::text(result.body, result.status);
  };
  auto coroutine = handler().take();
  coroutine.resume();
  assert(!coroutine.done());
  complete({200, "async body", ""});
  assert(coroutine.done());
  assert(coroutine.promise().response.body == "async body");
  coroutine.destroy();

  libcf::Fetcher inline_fetcher(
      [](std::string, auto callback) { callback({200, "inline body", ""}); },
      [](std::coroutine_handle<>) { assert(false && "inline completion must not resume recursively"); });
  auto inline_handler = [&]() -> libcf::Task {
    auto result = co_await inline_fetcher.get("https://example.test");
    co_return libcf::Response::text(result.body);
  };
  auto inline_coroutine = inline_handler().take();
  inline_coroutine.resume();
  assert(inline_coroutine.done());
  assert(inline_coroutine.promise().response.body == "inline body");
  inline_coroutine.destroy();

  auto cancelled = handler().take();
  cancelled.resume();
  cancelled.destroy();
  complete({200, "ignored after cancellation", ""});
}
