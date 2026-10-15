#include <cassert>
#include <string>

#include "cf/context.hpp"
#include "cf/crypto.hpp"
#include "cf/detail/header_wire.hpp"
#include "cf/env.hpp"
#include "cf/fetch.hpp"
#include "cf/http.hpp"
#include "cf/router.hpp"
#include "cf/task.hpp"

namespace {
void test_values() {
  auto success = cf::Result<int>::success(42);
  assert(success && success.value() == 42);
  auto failure = cf::Result<int>::failure({cf::ErrorCode::InvalidInput, "bad input"});
  assert(!failure && failure.error().message == "bad input");
  cf::Headers headers;
  headers.append("Content-Type", "text/plain");
  headers.append("content-type", "text/other");
  assert(headers.get("CONTENT-TYPE") == "text/plain");
  assert(headers.fields().size() == 2 && !headers.get("missing"));
  const std::uint8_t wire[] = {4, 0, 0, 0, 5, 0, 0, 0, 'x', '-', 'i', 'd', 'h', 'e', 'l', 'l', 'o'};
  auto parsed = cf::detail::parse_headers(wire);
  assert(parsed && parsed->get("X-ID") == "hello");
  assert(!cf::detail::parse_headers(std::span(wire, 2)));
  const std::uint8_t empty_name[] = {0, 0, 0, 0, 0, 0, 0, 0};
  assert(!cf::detail::parse_headers(empty_name));
  cf::Env env([](std::string_view name) -> std::optional<std::string> {
    return name == "TEST" ? std::optional<std::string>("value") : std::nullopt;
  });
  assert(env.var("TEST") == "value" && !env.var("NOT_SET") && !env.var(""));
}

void test_capabilities() {
  cf::Crypto crypto([](std::span<std::uint8_t> bytes) {
    for (auto& byte : bytes) byte = 0;
  });
  const auto uuid = crypto.random_uuid();
  assert(uuid.size() == 36 && uuid[14] == '4' && uuid[19] == '8');
  assert(crypto.random_bytes(16).size() == 16);
  bool rejected = false;
  try {
    (void)crypto.random_bytes(65537);
  } catch (const std::length_error&) {
    rejected = true;
  }
  assert(rejected);
  std::optional<cf::BackgroundWork> scheduled;
  cf::Context context([&](const cf::BackgroundWork& work) { scheduled = work; });
  context.wait_until(cf::BackgroundWork::kv_put("STATE_KV", "key", "value"));
  assert(scheduled && scheduled->kind == cf::BackgroundWork::Kind::KvPut);
  assert(scheduled->target == "STATE_KV" && scheduled->key == "key");
  auto response = cf::Response::streaming([index = 0]() mutable -> std::optional<std::string> {
    if (index++ == 0) return "first";
    return std::nullopt;
  });
  auto& stream = std::get<cf::StreamSource>(response.body);
  assert(stream.next() == "first" && !stream.next());
}

void test_router() {
  cf::Request request{"GET", "https://example.test/users/Alice?verbose=1", {}, ""};
  assert(request.path() == "/users/Alice");
  request.url = "https://example.test";
  assert(request.path() == "/");
  cf::Router router;
  assert(router.route("GET", "/users/:name", [](const auto&, const auto& params) {
    return cf::Response::text(std::string(params.get("name")));
  }));
  const auto fixed = [](const auto&, const auto&) { return cf::Response::text("static"); };
  assert(router.route("GET", "/users/me", fixed));
  assert(!router.route("GET", "/users/me", fixed));
  assert(!router.route("GET", "/users/:", fixed));
  request.url = "https://example.test/users/me";
  assert(std::get<std::string>(router.dispatch(request).body) == "static");
  request.url = "https://example.test/users/Alice";
  assert(std::get<std::string>(router.dispatch(request).body) == "Alice");
  request.method = "POST";
  assert(router.dispatch(request).status == 405);
  request.url = "https://example.test/missing";
  assert(router.dispatch(request).status == 404);
}

void test_coroutines() {
  cf::Fetcher::Completion complete;
  cf::Fetcher fetcher(
      [&](std::string url, auto callback) {
        assert(url == "https://example.test/asset");
        complete = std::move(callback);
      },
      [](std::coroutine_handle<> handle) { handle.resume(); });
  auto handler = [&]() -> cf::Task {
    auto result = co_await fetcher.get("https://example.test/asset");
    co_return cf::Response::text(result.value().body, result.value().status);
  };
  auto coroutine = handler().take();
  coroutine.resume();
  assert(!coroutine.done());
  complete(cf::FetchResult::success({200, "async body"}));
  assert(coroutine.done());
  assert(std::get<std::string>(coroutine.promise().response.body) == "async body");
  coroutine.destroy();
  complete(cf::FetchResult::success({200, "late duplicate"}));
  cf::Fetcher inline_fetcher(
      [](std::string, auto callback) {
        callback(cf::FetchResult::success({200, "inline body"}));
        callback(cf::FetchResult::success({200, "duplicate must be ignored"}));
      },
      [](std::coroutine_handle<>) {
        assert(false && "inline completion must not resume recursively");
      });
  auto inline_handler = [&]() -> cf::Task {
    auto result = co_await inline_fetcher.get("https://example.test");
    co_return cf::Response::text(result.value().body);
  };
  auto inline_coroutine = inline_handler().take();
  inline_coroutine.resume();
  assert(inline_coroutine.done());
  assert(std::get<std::string>(inline_coroutine.promise().response.body) == "inline body");
  inline_coroutine.destroy();
  auto cancelled = handler().take();
  cancelled.resume();
  cancelled.destroy();
  complete(cf::FetchResult::success({200, "ignored after cancellation"}));
}
}  // namespace

int main() {
  test_values();
  test_capabilities();
  test_router();
  test_coroutines();
}
