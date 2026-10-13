#include <cassert>
#include <coroutine>
#include <string>
#include <utility>

#include "cf/cache.hpp"
#include "cf/kv.hpp"
#include "cf/r2.hpp"
#include "cf/task.hpp"

namespace {
void append_u32(cf::Bytes& bytes, std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) bytes.push_back((value >> shift) & 0xff);
}
void append_string(cf::Bytes& bytes, const std::string& value) {
  append_u32(bytes, static_cast<std::uint32_t>(value.size()));
  bytes.insert(bytes.end(), value.begin(), value.end());
}
}

int main() {
  cf::Bytes metadata;
  for (const auto& field : {"object", "4", "etag", "\"etag\"", "application/octet-stream"})
    append_string(metadata, field);
  auto head = cf::detail::decode_r2_head({cf::ReplyKind::Value, metadata});
  assert(head && head.value() && head.value()->key == "object" && head.value()->size == 4);
  metadata.push_back(0);
  assert(!cf::detail::decode_r2_head({cf::ReplyKind::Value, metadata}));
  assert(!cf::detail::decode_r2_head({cf::ReplyKind::Value, {1, 2}}));
  auto missing_head = cf::detail::decode_r2_head({cf::ReplyKind::Missing, {}});
  assert(missing_head && !missing_head.value());

  cf::OperationCall last{};
  cf::BindingRuntime::Completion complete;
  cf::BindingRuntime runtime([&](cf::OperationCall call, auto callback) {
    last = std::move(call);
    complete = std::move(callback);
  }, [](std::coroutine_handle<> handle) { handle.resume(); });
  // Remove the callback before invoking it: resumption may replace complete
  // with the next operation's callback.
  const auto deliver = [&](cf::OperationReply reply) {
    auto callback = std::exchange(complete, {});
    callback(cf::Result<cf::OperationReply>::success(std::move(reply)));
  };
  cf::KvNamespace kv(runtime, "TEST_KV");
  auto handler = [&]() -> cf::Task {
    auto result = co_await kv.get_text("present");
    assert(result && result.value() == "hello");
    auto missing = co_await kv.get_text("missing");
    assert(missing && !missing.value());
    auto put = co_await kv.put_text("new", "world", {.expiration_ttl = 60});
    assert(put);
    auto page = co_await kv.list("prefix:", "cursor-1", 2);
    assert(page && page.value().keys.size() == 1);
    assert(page.value().keys[0].name == "prefix:one");
    assert(page.value().keys[0].metadata_json == "{\"origin\":\"test\"}");
    assert(page.value().next_cursor == "cursor-2");
    co_return cf::Response::text("done");
  };
  auto coroutine = handler().take();
  coroutine.resume();
  assert(last.method == cf::Operation::KvGetText && last.binding == "TEST_KV");
  deliver({cf::ReplyKind::Value, {'h', 'e', 'l', 'l', 'o'}});
  assert(last.key == "missing");
  deliver({cf::ReplyKind::Missing, {}});
  assert(last.method == cf::Operation::KvPut && last.key == "new");
  assert(std::string(last.body.begin(), last.body.end()) == "world");
  assert(last.options == "60\n\n");
  deliver({cf::ReplyKind::Value, {}});
  assert(last.method == cf::Operation::KvList && last.key == "prefix:");
  assert(last.options == "cursor-1");
  assert(std::string(last.body.begin(), last.body.end()) == "2");
  cf::Bytes encoded;
  append_u32(encoded, 1);
  append_u32(encoded, 0);
  append_string(encoded, "cursor-2");
  append_string(encoded, "prefix:one");
  append_string(encoded, "42");
  append_string(encoded, "{\"origin\":\"test\"}");
  deliver({cf::ReplyKind::Value, encoded});
  assert(coroutine.done());
  coroutine.destroy();
  auto malformed = [&]() -> cf::Task {
    auto page = co_await kv.list();
    assert(!page && page.error().code == cf::ErrorCode::InvalidInput);
    co_return cf::Response::text("rejected");
  };
  auto bad = malformed().take();
  bad.resume();
  deliver({cf::ReplyKind::Value, {1, 2}});
  assert(bad.done());
  bad.destroy();

  cf::Cache cache(runtime);
  auto cache_handler = [&]() -> cf::Task {
    cf::CachedResponse invalid;
    invalid.status = 99;
    auto rejected = co_await cache.put("https://example.test/key", std::move(invalid));
    assert(!rejected && rejected.error().code == cf::ErrorCode::InvalidInput);
    auto entry = co_await cache.match("https://example.test/key");
    assert(!entry && entry.error().code == cf::ErrorCode::InvalidInput);
    auto erased = co_await cache.erase("https://example.test/key");
    assert(erased && !erased.value());
    co_return cf::Response::text("cache checked");
  };
  auto cache_task = cache_handler().take();
  cache_task.resume();
  assert(last.method == cf::Operation::CacheMatch);
  deliver({cf::ReplyKind::Value, {1, 2}});
  assert(last.method == cf::Operation::CacheDelete);
  deliver({cf::ReplyKind::Value, {0}});
  assert(cache_task.done());
  cache_task.destroy();
}
