#include "cf/worker.hpp"

#include <climits>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>

#include "cf/detail/header_wire.hpp"
#include "cf/subtle_crypto.hpp"

extern "C" {
int libcf_host_var(int id, const char* key, int key_length, char* output, int capacity);
void libcf_host_finish(int id, int status, const char* headers, int header_length, const char* body,
                       int length);
void libcf_host_fetch(int operation, int invocation, const char* path, int length);
void libcf_host_random(std::uint8_t* output, int length);
double libcf_host_now();
void libcf_host_background(int id, int kind, const char* target, int target_length, const char* key,
                           int key_length, const char* value, int value_length);
void libcf_host_stream_begin(int id, int status, const char* headers, int header_length);
void libcf_host_stream_emit(int id, const char* bytes, int length, int done);
void libcf_host_operation(int operation, int invocation, int method, const char* binding,
                          int binding_length, const char* key, int key_length,
                          const std::uint8_t* body, int body_length, const char* options,
                          int options_length);
void libcf_host_digest(int ticket, int invocation, int algorithm, const std::uint8_t* input,
                       int length);
}

namespace {

struct PendingFetch {
  int invocation;
  cf::Fetcher::Completion finish;
};
struct PendingOperation {
  int invocation;
  cf::BindingRuntime::Completion finish;
  cf::Bytes reply;  // written in place by the host before libcf_operation_done
};
struct PendingDigest {
  int invocation;
  cf::DigestWaiter* waiter;
};
std::unordered_map<int, cf::Task::Handle> active_tasks;
std::unordered_map<int, PendingFetch> active_fetches;
std::unordered_map<int, PendingOperation> active_operations;
std::unordered_map<int, cf::StreamSource> active_streams;
std::unordered_map<std::uint32_t, PendingDigest> active_digests;
std::uint32_t next_digest = 0;
// The host writes a finished digest here, then calls libcf_digest_done. Static
// storage, so a late completion never writes into a destroyed coroutine frame.
alignas(8) std::uint8_t digest_scratch[64];
// Request bytes are written here by the host immediately before libcf_http,
// so the body moves into cf::Request without another copy.
std::string pending_head;
std::string pending_body;

class HostDigests final : public cf::DigestHost {
 public:
  std::uint32_t start(int invocation, cf::DigestAlgorithm algorithm,
                      std::span<const std::uint8_t> input, cf::DigestWaiter& waiter) const override {
    if (input.size() > cf::kMaxDigestInput || next_digest == INT_MAX) {
      waiter.digest_complete(
          cf::Result<std::span<const std::uint8_t>>::failure({cf::ErrorCode::ResourceLimit, "digest exceeds bridge limits"}));
      return 0;
    }
    const auto ticket = ++next_digest;
    active_digests.emplace(ticket, PendingDigest{invocation, &waiter});
    libcf_host_digest(static_cast<int>(ticket), invocation, static_cast<int>(algorithm), input.data(),
                      static_cast<int>(input.size()));
    return ticket;
  }
  void detach(std::uint32_t ticket) const override { active_digests.erase(ticket); }
};
const HostDigests host_digests;
int next_fetch = 0;
int next_operation = 0;

std::optional<std::string> lookup_var(int id, std::string_view name) {
  if (name.size() > 65536) return std::nullopt;
  const auto size = libcf_host_var(id, name.data(), static_cast<int>(name.size()), nullptr, 0);
  if (size < 0 || size > 65536) return std::nullopt;
  std::string value(static_cast<std::size_t>(size), '\0');
  if (size != 0 &&
      libcf_host_var(id, name.data(), static_cast<int>(name.size()), value.data(), size) != size)
    return std::nullopt;
  return value;
}

void send(int id, cf::Response response) {
  // JS Response rejects these values. Do not emit partial headers or a stream
  // before discovering an invalid status in a user-defined C++ handler.
  if (response.status < 200 || response.status > 599)
    response = cf::Response::text("invalid response status", 500);
  // All headers cross in one call, in the request header wire format.
  static std::string header_wire;
  header_wire.clear();
  cf::detail::encode_headers(response.headers, header_wire);
  const auto header_length = static_cast<int>(header_wire.size());
  if (auto* body = std::get_if<std::string>(&response.body)) {
    libcf_host_finish(id, response.status, header_wire.data(), header_length, body->data(),
                      static_cast<int>(body->size()));
    return;
  }
  active_streams.emplace(id, std::get<cf::StreamSource>(std::move(response.body)));
  libcf_host_stream_begin(id, response.status, header_wire.data(), header_length);
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

cf::WorkerContext make_context(int id) {
  cf::Env env([id](std::string_view name) { return lookup_var(id, name); });
  cf::Context execution([id](const cf::BackgroundWork& work) {
    libcf_host_background(id, static_cast<int>(work.kind), work.target.data(),
                          static_cast<int>(work.target.size()), work.key.data(),
                          static_cast<int>(work.key.size()), work.value.data(),
                          static_cast<int>(work.value.size()));
  });
  cf::Fetcher assets(
      [id](std::string path, cf::Fetcher::Completion done) {
        if (next_fetch == INT_MAX) {
          done(cf::FetchResult::failure({cf::ErrorCode::ResourceLimit, "operation IDs exhausted"}));
          return;
        }
        const int operation = ++next_fetch;
        active_fetches.emplace(operation, PendingFetch{id, std::move(done)});
        libcf_host_fetch(operation, id, path.data(), static_cast<int>(path.size()));
      },
      [id](std::coroutine_handle<>) { drive(id); });
  cf::BindingRuntime bindings(
      [id](cf::OperationCall call, cf::BindingRuntime::Completion done) {
        if (next_operation == INT_MAX || call.binding.size() > 1024 || call.key.size() > 65536 ||
            call.body.size() > 1024 * 1024 || call.options.size() > 65536) {
          done(cf::Result<cf::OperationReply>::failure(
              {cf::ErrorCode::ResourceLimit, "operation exceeds bridge limits"}));
          return;
        }
        const int operation = ++next_operation;
        active_operations.emplace(operation, PendingOperation{id, std::move(done), {}});
        libcf_host_operation(operation, id, static_cast<int>(call.method), call.binding.data(),
                             static_cast<int>(call.binding.size()), call.key.data(),
                             static_cast<int>(call.key.size()), call.body.data(),
                             static_cast<int>(call.body.size()), call.options.data(),
                             static_cast<int>(call.options.size()));
      },
      [id](std::coroutine_handle<>) { drive(id); }, cf::DigestRoute{&host_digests, id});
  cf::Crypto crypto([](std::span<std::uint8_t> bytes) {
    libcf_host_random(bytes.data(), static_cast<int>(bytes.size()));
  });
  cf::WallClock clock([] { return libcf_host_now(); });
  return {std::move(env), std::move(execution), std::move(assets), std::move(bindings),
          std::move(crypto), std::move(clock)};
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
    callback(cf::FetchResult::failure({cf::ErrorCode::HostFailure, "fetch failed"}));
    return;
  }
  callback(cf::FetchResult::success({status, std::string(body, static_cast<std::size_t>(length))}));
}

// Sizes the pending reply and returns where the host writes it (null if the
// operation is gone or the length is invalid). Only called for non-empty replies.
extern "C" std::uint8_t* libcf_operation_reply(int operation, int length) {
  auto it = active_operations.find(operation);
  if (it == active_operations.end() || length <= 0 || length > 4 * 1024 * 1024) return nullptr;
  it->second.reply.resize(static_cast<std::size_t>(length));
  return it->second.reply.data();
}

extern "C" void libcf_operation_done(int operation, int status, int length) {
  auto it = active_operations.find(operation);
  if (it == active_operations.end()) return;
  auto callback = std::move(it->second.finish);
  auto payload = std::move(it->second.reply);
  active_operations.erase(it);
  if (length < 0 || static_cast<std::size_t>(length) != payload.size()) {
    callback(cf::Result<cf::OperationReply>::failure(
        {cf::ErrorCode::InvalidInput, "invalid host result length"}));
    return;
  }
  if (status == 2) {
    callback(cf::Result<cf::OperationReply>::failure(
        {cf::ErrorCode::HostFailure,
         length ? std::string(payload.begin(), payload.end()) : "binding failed"}));
    return;
  }
  if (status != 0 && status != 1) {
    callback(cf::Result<cf::OperationReply>::failure(
        {cf::ErrorCode::InvalidInput, "invalid host result status"}));
    return;
  }
  callback(cf::Result<cf::OperationReply>::success(
      {status == 1 ? cf::ReplyKind::Missing : cf::ReplyKind::Value, std::move(payload)}));
}

extern "C" std::uint8_t* libcf_digest_scratch() { return digest_scratch; }

extern "C" void libcf_digest_done(int ticket, int status, int length) {
  auto it = active_digests.find(static_cast<std::uint32_t>(ticket));
  if (it == active_digests.end()) return;
  auto* waiter = it->second.waiter;
  active_digests.erase(it);
  if (status != 0 || length <= 0 || length > static_cast<int>(sizeof digest_scratch)) {
    waiter->digest_complete(cf::Result<std::span<const std::uint8_t>>::failure(
        {cf::ErrorCode::HostFailure, "digest failed"}));
    return;
  }
  waiter->digest_complete(cf::Result<std::span<const std::uint8_t>>::success(
      std::span<const std::uint8_t>(digest_scratch, static_cast<std::size_t>(length))));
}

// Sizes `text` without initializing it: the host overwrites every byte before
// C++ reads it. Zero-filling a 1 MiB body cost about 0.8 ns per byte.
void resize_for_host(std::string& text, std::size_t length) {
#if defined(__cpp_lib_string_resize_and_overwrite)
  text.resize_and_overwrite(length, [](char*, std::size_t size) { return size; });
#else
  text.resize(length);
#endif
}

extern "C" char* libcf_request_head(int length) {
  if (length < 0 || length > 32 + 8192 + 65536) return nullptr;
  resize_for_host(pending_head, static_cast<std::size_t>(length));
  return pending_head.data();
}

extern "C" char* libcf_request_body(int length) {
  if (length < 0 || length > 1024 * 1024) return nullptr;
  resize_for_host(pending_body, static_cast<std::size_t>(length));
  return pending_body.data();
}

extern "C" void libcf_cancel(int id) {
  active_streams.erase(id);
  for (auto it = active_fetches.begin(); it != active_fetches.end();) {
    if (it->second.invocation == id)
      it = active_fetches.erase(it);
    else
      ++it;
  }
  for (auto it = active_operations.begin(); it != active_operations.end();) {
    if (it->second.invocation == id)
      it = active_operations.erase(it);
    else
      ++it;
  }
  // Before destroying the task: its digest awaitables then detach nothing.
  for (auto it = active_digests.begin(); it != active_digests.end();) {
    if (it->second.invocation == id)
      it = active_digests.erase(it);
    else
      ++it;
  }
  auto task = active_tasks.find(id);
  if (task != active_tasks.end()) {
    task->second.destroy();
    active_tasks.erase(task);
  }
}

extern "C" void libcf_http(int id, const char* method, int method_length, const char* url,
                           int url_length, const std::uint8_t* headers, int header_length,
                           const char* body, int body_length) {
  if (method_length < 1 || url_length < 1 || header_length < 0 || body_length < 0 ||
      method_length > 32 || url_length > 8192 || header_length > 65536 ||
      body_length > 1024 * 1024) {
    send(id, cf::Response::text("invalid request size", 400));
    return;
  }
  auto parsed =
      cf::detail::parse_headers(std::span(headers, static_cast<std::size_t>(header_length)));
  if (!parsed) {
    send(id, cf::Response::text("invalid headers", 400));
    return;
  }
  // The body must be the buffer from libcf_request_body; it moves, uncopied.
  if (body != pending_body.data() || static_cast<std::size_t>(body_length) != pending_body.size()) {
    send(id, cf::Response::text("invalid request body", 400));
    return;
  }
  cf::Request request{std::string(method, method_length), std::string(url, url_length),
                      std::move(*parsed), std::exchange(pending_body, std::string())};
  if (active_tasks.contains(id)) {
    send(id, cf::Response::text("duplicate invocation", 500));
    return;
  }
  auto task = cf::handle(std::move(request), make_context(id));
  active_tasks.emplace(id, task.take());
  drive(id);
}
