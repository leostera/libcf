#include <charconv>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>

#include "libcf/context.hpp"
#include "libcf/crypto.hpp"
#include "libcf/detail/header_wire.hpp"
#include "libcf/env.hpp"
#include "libcf/fetch.hpp"
#include "libcf/router.hpp"
#include "libcf/task.hpp"

extern "C" {
int libcf_host_var(int id, const char* key, int key_length, char* output, int capacity);
void libcf_host_header(int id, const char* name, int name_length,
                       const char* value, int value_length);
void libcf_host_finish(int id, int status, const char* body, int length);
void libcf_host_fetch(int operation, int invocation, const char* path, int length);
void libcf_host_random(std::uint8_t* output, int length);
void libcf_host_background(int id, int kind, const char* target, int target_length,
                           const char* key, int key_length, const char* value, int value_length);
void libcf_host_stream_begin(int id, int status);
void libcf_host_stream_emit(int id, const char* bytes, int length, int done);
}

namespace {

struct PendingFetch {
  int invocation;
  libcf::Fetcher::Completion finish;
};
std::unordered_map<int, libcf::Task::Handle> active_tasks;
std::unordered_map<int, PendingFetch> active_fetches;
std::unordered_map<int, libcf::StreamSource> active_streams;
int next_fetch = 0;

std::optional<std::string> lookup_var(int id, std::string_view name) {
  const auto size = libcf_host_var(id, name.data(), static_cast<int>(name.size()), nullptr, 0);
  if (size < 0 || size > 65536) return std::nullopt;
  std::string value(static_cast<std::size_t>(size), '\0');
  if (size != 0 && libcf_host_var(id, name.data(), static_cast<int>(name.size()),
                                value.data(), size) != size) return std::nullopt;
  return value;
}

void send(int id, libcf::Response response) {
  // JS Response rejects invalid status codes; reject them here before emitting
  // headers or starting a stream, so a bad C++ handler cannot leak state.
  if (response.status < 200 || response.status > 599) {
    response = libcf::Response::text("invalid response status", 500);
  }
  for (const auto& header : response.headers.fields()) {
    libcf_host_header(id, header.name.data(), static_cast<int>(header.name.size()),
                      header.value.data(), static_cast<int>(header.value.size()));
  }
  if (auto* body = std::get_if<std::string>(&response.body)) {
    libcf_host_finish(id, response.status, body->data(), static_cast<int>(body->size()));
    return;
  }
  active_streams.emplace(id, std::get<libcf::StreamSource>(std::move(response.body)));
  libcf_host_stream_begin(id, response.status);
}

libcf::Response handle(int id, const libcf::Request& request) {
  libcf::Env env([id](std::string_view name) { return lookup_var(id, name); });
  libcf::Context context([id](const libcf::BackgroundWork& work) {
    libcf_host_background(id, static_cast<int>(work.kind), work.target.data(),
                          static_cast<int>(work.target.size()), work.key.data(),
                          static_cast<int>(work.key.size()), work.value.data(),
                          static_cast<int>(work.value.size()));
  });
  libcf::Router router;
  router.route("GET", "/hello/:name", [](const auto&, const auto& params) {
    return libcf::Response::text("Hello, " + std::string(params.get("name")) + "!");
  });
  router.route("POST", "/echo", [](const auto& req, const auto&) {
    auto response = libcf::Response::text(req.body);
    response.headers.append("x-libcf", "cpp");
    return response;
  });
  router.route("GET", "/header", [](const auto& req, const auto&) {
    return libcf::Response::text(std::string(req.headers.get("x-greeting").value_or("absent")));
  });
  router.route("POST", "/background/:key", [&context](const auto& req, const auto& params) {
    context.wait_until(libcf::BackgroundWork::kv_put("STATE_KV",
                                                     std::string(params.get("key")), req.body));
    return libcf::Response::text("queued", 202);
  });
  router.route("GET", "/stream/:count", [](const auto&, const auto& params) {
    const auto text = params.get("count");
    unsigned count = 0;
    const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), count);
    if (error != std::errc{} || end != text.data() + text.size() || count > 128)
      return libcf::Response::text("invalid count", 400);
    return libcf::Response::streaming([index = 0U, count]() mutable -> std::optional<std::string> {
      if (index >= count) return std::nullopt;
      return "chunk-" + std::to_string(index++) + "\n";
    });
  });
  router.route("GET", "/uuid", [](const auto&, const auto&) {
    libcf::Crypto crypto([](std::span<std::uint8_t> bytes) {
      libcf_host_random(bytes.data(), static_cast<int>(bytes.size()));
    });
    return libcf::Response::text(crypto.random_uuid());
  });
  router.route("GET", "/env/:name", [&env](const auto&, const auto& params) {
    auto value = env.var(params.get("name"));
    return value ? libcf::Response::text(*value) : libcf::Response::text("binding missing", 404);
  });
  return router.dispatch(request);
}

void drive(int id) {
  auto it = active_tasks.find(id);
  if (it == active_tasks.end()) return;  // cancelled request
  auto handle = it->second;
  handle.resume();
  if (!handle.done()) return;
  auto response = std::move(handle.promise().response);
  active_tasks.erase(it);
  handle.destroy();
  send(id, std::move(response));
}

libcf::Task handle_async(int id, libcf::Request request) {
  if (request.path() != "/asset") co_return handle(id, request);
  libcf::Fetcher fetcher(
      [id](std::string path, libcf::Fetcher::Completion done) {
        const int operation = ++next_fetch;
        active_fetches.emplace(operation, PendingFetch{id, std::move(done)});
        libcf_host_fetch(operation, id, path.data(), static_cast<int>(path.size()));
      },
      [id](std::coroutine_handle<>) { drive(id); });
  auto result = co_await fetcher.get("/hello.txt");
  if (!result) co_return libcf::Response::text("fetch failed", 502);
  co_return libcf::Response::text("C++[" + result.value().body + "]", result.value().status);
}

}  // namespace

extern "C" void libcf_stream_pull(int id) {
  auto it = active_streams.find(id);
  if (it == active_streams.end()) return;
  auto chunk = it->second.next();
  if (!chunk) {
    active_streams.erase(it);
    libcf_host_stream_emit(id, nullptr, 0, 1);
    return;
  }
  libcf_host_stream_emit(id, chunk->data(), static_cast<int>(chunk->size()), 0);
}

extern "C" void libcf_stream_cancel(int id) { active_streams.erase(id); }

extern "C" void libcf_fetch_done(int operation, int status, const char* body, int length) {
  auto it = active_fetches.find(operation);
  if (it == active_fetches.end()) return;  // result arrived after cancellation
  auto callback = std::move(it->second.finish);
  active_fetches.erase(it);
  if (length < 0 || length > 1024 * 1024 || status == 0) {
    callback(libcf::FetchResult::failure({libcf::ErrorCode::HostFailure, "fetch failed"}));
    return;
  }
  callback(libcf::FetchResult::success(
      {status, std::string(body, static_cast<std::size_t>(length))}));
}

extern "C" void libcf_cancel(int id) {
  active_streams.erase(id);
  for (auto it = active_fetches.begin(); it != active_fetches.end();) {
    if (it->second.invocation == id) it = active_fetches.erase(it);
    else ++it;
  }
  auto task = active_tasks.find(id);
  if (task != active_tasks.end()) {
    task->second.destroy();
    active_tasks.erase(task);
  }
}

extern "C" void libcf_http(int id, const char* method, int method_length,
                           const char* url, int url_length,
                           const std::uint8_t* headers, int header_length,
                           const char* body, int body_length) {
  if (method_length < 1 || url_length < 1 || header_length < 0 || body_length < 0 ||
      method_length > 32 || url_length > 8192 || header_length > 65536 ||
      body_length > 1024 * 1024) {
    send(id, libcf::Response::text("invalid request size", 400));
    return;
  }
  auto parsed = libcf::detail::parse_headers(std::span(headers, static_cast<std::size_t>(header_length)));
  if (!parsed) {
    send(id, libcf::Response::text("invalid headers", 400));
    return;
  }
  libcf::Request request{std::string(method, method_length), std::string(url, url_length),
                         std::move(*parsed), std::string(body, body_length)};
  if (active_tasks.contains(id)) {
    send(id, libcf::Response::text("duplicate invocation", 500));
    return;
  }
  auto task = handle_async(id, std::move(request));
  active_tasks.emplace(id, task.take());
  drive(id);
}
