#include "libcf/worker.hpp"

#include <climits>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>

#include "libcf/detail/header_wire.hpp"

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
void libcf_host_operation(int operation, int invocation, int method,
                          const char* binding, int binding_length,
                          const char* key, int key_length,
                          const std::uint8_t* body, int body_length,
                          const char* options, int options_length);
}

namespace {

struct PendingFetch {
  int invocation;
  libcf::Fetcher::Completion finish;
};
struct PendingOperation {
  int invocation;
  libcf::BindingRuntime::Completion finish;
};
std::unordered_map<int, libcf::Task::Handle> active_tasks;
std::unordered_map<int, PendingFetch> active_fetches;
std::unordered_map<int, PendingOperation> active_operations;
std::unordered_map<int, libcf::StreamSource> active_streams;
int next_fetch = 0;
int next_operation = 0;

std::optional<std::string> lookup_var(int id, std::string_view name) {
  if (name.size() > 65536) return std::nullopt;
  const auto size = libcf_host_var(id, name.data(), static_cast<int>(name.size()), nullptr, 0);
  if (size < 0 || size > 65536) return std::nullopt;
  std::string value(static_cast<std::size_t>(size), '\0');
  if (size != 0 && libcf_host_var(id, name.data(), static_cast<int>(name.size()),
                                 value.data(), size) != size) return std::nullopt;
  return value;
}

void send(int id, libcf::Response response) {
  // JS Response rejects these values. Do not emit partial headers or a stream
  // before discovering an invalid status in a user-defined C++ handler.
  if (response.status < 200 || response.status > 599)
    response = libcf::Response::text("invalid response status", 500);
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

void drive(int id) {
  auto it = active_tasks.find(id);
  if (it == active_tasks.end()) return;  // request was cancelled
  auto handle = it->second;
  handle.resume();
  if (!handle.done()) return;
  auto response = std::move(handle.promise().response);
  active_tasks.erase(it);
  handle.destroy();
  send(id, std::move(response));
}

libcf::WorkerContext make_context(int id) {
  libcf::Env env([id](std::string_view name) { return lookup_var(id, name); });
  libcf::Context execution([id](const libcf::BackgroundWork& work) {
    libcf_host_background(id, static_cast<int>(work.kind), work.target.data(),
                          static_cast<int>(work.target.size()), work.key.data(),
                          static_cast<int>(work.key.size()), work.value.data(),
                          static_cast<int>(work.value.size()));
  });
  libcf::Fetcher assets(
      [id](std::string path, libcf::Fetcher::Completion done) {
        if (next_fetch == INT_MAX) {
          done(libcf::FetchResult::failure({libcf::ErrorCode::ResourceLimit, "operation IDs exhausted"}));
          return;
        }
        const int operation = ++next_fetch;
        active_fetches.emplace(operation, PendingFetch{id, std::move(done)});
        libcf_host_fetch(operation, id, path.data(), static_cast<int>(path.size()));
      },
      [id](std::coroutine_handle<>) { drive(id); });
  libcf::BindingRuntime bindings(
      [id](libcf::OperationCall call, libcf::BindingRuntime::Completion done) {
        if (next_operation == INT_MAX || call.binding.size() > 1024 ||
            call.key.size() > 65536 || call.body.size() > 1024 * 1024 ||
            call.options.size() > 65536) {
          done(libcf::Result<libcf::OperationReply>::failure(
              {libcf::ErrorCode::ResourceLimit, "operation exceeds bridge limits"}));
          return;
        }
        const int operation = ++next_operation;
        active_operations.emplace(operation, PendingOperation{id, std::move(done)});
        libcf_host_operation(operation, id, static_cast<int>(call.method),
                             call.binding.data(), static_cast<int>(call.binding.size()),
                             call.key.data(), static_cast<int>(call.key.size()),
                             call.body.data(), static_cast<int>(call.body.size()),
                             call.options.data(), static_cast<int>(call.options.size()));
      },
      [id](std::coroutine_handle<>) { drive(id); });
  libcf::Crypto crypto([](std::span<std::uint8_t> bytes) {
    libcf_host_random(bytes.data(), static_cast<int>(bytes.size()));
  });
  return {std::move(env), std::move(execution), std::move(assets),
          std::move(bindings), std::move(crypto)};
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
  if (it == active_fetches.end()) return;
  auto callback = std::move(it->second.finish);
  active_fetches.erase(it);
  if (length < 0 || length > 1024 * 1024 || status == 0) {
    callback(libcf::FetchResult::failure({libcf::ErrorCode::HostFailure, "fetch failed"}));
    return;
  }
  callback(libcf::FetchResult::success(
      {status, std::string(body, static_cast<std::size_t>(length))}));
}

extern "C" void libcf_operation_done(int operation, int status,
                                      const std::uint8_t* bytes, int length) {
  auto it = active_operations.find(operation);
  if (it == active_operations.end()) return;
  auto callback = std::move(it->second.finish);
  active_operations.erase(it);
  if (length < 0 || length > 4 * 1024 * 1024) {
    callback(libcf::Result<libcf::OperationReply>::failure(
        {libcf::ErrorCode::InvalidInput, "invalid host result length"}));
    return;
  }
  if (status == 2) {
    callback(libcf::Result<libcf::OperationReply>::failure(
        {libcf::ErrorCode::HostFailure,
         length ? std::string(reinterpret_cast<const char*>(bytes), length) : "binding failed"}));
    return;
  }
  if (status != 0 && status != 1) {
    callback(libcf::Result<libcf::OperationReply>::failure(
        {libcf::ErrorCode::InvalidInput, "invalid host result status"}));
    return;
  }
  libcf::Bytes payload;
  if (length) payload.assign(bytes, bytes + length);
  callback(libcf::Result<libcf::OperationReply>::success(
      {status == 1 ? libcf::ReplyKind::Missing : libcf::ReplyKind::Value,
       std::move(payload)}));
}

extern "C" void libcf_cancel(int id) {
  active_streams.erase(id);
  for (auto it = active_fetches.begin(); it != active_fetches.end();) {
    if (it->second.invocation == id) it = active_fetches.erase(it);
    else ++it;
  }
  for (auto it = active_operations.begin(); it != active_operations.end();) {
    if (it->second.invocation == id) it = active_operations.erase(it);
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
  auto parsed = libcf::detail::parse_headers(
      std::span(headers, static_cast<std::size_t>(header_length)));
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
  auto task = libcf::handle(std::move(request), make_context(id));
  active_tasks.emplace(id, task.take());
  drive(id);
}
