#include <cassert>
#include <coroutine>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "libcf/kv.hpp"
#include "libcf/task.hpp"

namespace {
void append_u32(libcf::Bytes& bytes, std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) bytes.push_back((value >> shift) & 0xff);
}
void append_string(libcf::Bytes& bytes, const std::string& value) {
  append_u32(bytes, static_cast<std::uint32_t>(value.size()));
  bytes.insert(bytes.end(), value.begin(), value.end());
}
}

int main() {
  libcf::OperationCall last{};
  libcf::BindingRuntime::Completion complete;
  libcf::BindingRuntime runtime(
      [&](libcf::OperationCall call, auto callback) {
        last = std::move(call);
        complete = std::move(callback);
      },
      [](std::coroutine_handle<> handle) { handle.resume(); });
  libcf::KvNamespace kv(runtime, "TEST_KV");
  auto handler = [&]() -> libcf::Task {
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
    co_return libcf::Response::text("done");
  };
  auto coroutine = handler().take();
  coroutine.resume();
  assert(last.method == libcf::Operation::KvGetText && last.binding == "TEST_KV");
  complete(libcf::Result<libcf::OperationReply>::success(
      {libcf::ReplyKind::Value, {'h', 'e', 'l', 'l', 'o'}}));
  assert(last.key == "missing");
  complete(libcf::Result<libcf::OperationReply>::success({libcf::ReplyKind::Missing, {}}));
  assert(last.method == libcf::Operation::KvPut && last.key == "new");
  assert(std::string(last.body.begin(), last.body.end()) == "world");
  assert(last.options == "{\"expirationTtl\":60}");
  complete(libcf::Result<libcf::OperationReply>::success({libcf::ReplyKind::Value, {}}));
  assert(last.method == libcf::Operation::KvList && last.key == "prefix:");
  assert(last.options == "cursor-1");
  assert(std::string(last.body.begin(), last.body.end()) == "2");
  libcf::Bytes encoded;
  append_u32(encoded, 1);      // one key
  append_u32(encoded, 0);      // more pages
  append_string(encoded, "cursor-2");
  append_string(encoded, "prefix:one");
  append_string(encoded, "42");
  append_string(encoded, "{\"origin\":\"test\"}");
  complete(libcf::Result<libcf::OperationReply>::success({libcf::ReplyKind::Value, encoded}));
  assert(coroutine.done());
  coroutine.destroy();

  auto malformed = [&]() -> libcf::Task {
    auto page = co_await kv.list();
    assert(!page && page.error().code == libcf::ErrorCode::InvalidInput);
    co_return libcf::Response::text("rejected");
  };
  auto bad = malformed().take();
  bad.resume();
  complete(libcf::Result<libcf::OperationReply>::success({libcf::ReplyKind::Value, {1, 2}}));
  assert(bad.done());
  bad.destroy();
}
