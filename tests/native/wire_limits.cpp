#include <cassert>
#include <limits>
#include "cf/kv.hpp"
#include "cf/r2.hpp"
#include "cf/sql.hpp"
#include "cf/task.hpp"
#include "cf/detail/header_wire.hpp"

namespace {
cf::Bytes page(bool kv, std::uint32_t count, std::string cursor = {}, bool incomplete = false) {
  cf::Bytes bytes;
  cf::detail::append_u32(bytes, count);
  cf::detail::append_u32(bytes, kv ? !incomplete : incomplete);
  cf::detail::append_field(bytes, cursor);
  for (std::uint32_t i = 0; i < count; ++i) {
    cf::detail::append_field(bytes, "key");
    if (kv) {
      cf::detail::append_field(bytes, "");
      cf::detail::append_field(bytes, "");
    } else {
      for (const auto field : {"0", "etag", "\"etag\"", ""}) cf::detail::append_field(bytes, field);
    }
  }
  return bytes;
}
void check(bool kv, cf::OperationReply reply, std::uint32_t limit, bool expected) {
  cf::BindingRuntime runtime([&](auto, auto done) {
    done(cf::Result<cf::OperationReply>::success(std::move(reply)));
  }, [](auto handle) { handle.resume(); });
  cf::KvNamespace keys(runtime, "KV");
  cf::R2Bucket objects(runtime, "R2");
  auto run = [&]() -> cf::Task {
    if (kv) {
      auto result = co_await keys.list({}, {}, limit);
      assert(static_cast<bool>(result) == expected);
    } else {
      auto result = co_await objects.list({}, {}, limit);
      assert(static_cast<bool>(result) == expected);
    }
    co_return cf::Response::text("checked");
  };
  auto task = run().take(); task.resume(); assert(task.done()); task.destroy();
}
}
int main() {
  using namespace cf;
  for (const bool kv : {true, false}) {
    check(kv, {ReplyKind::Value, page(kv, 0)}, 1, true);
    check(kv, {ReplyKind::Value, page(kv, 1)}, 1, true);
    check(kv, {ReplyKind::Value, page(kv, 1000)}, 1000, true);
    check(kv, {ReplyKind::Value, page(kv, 2)}, 1, false);
    check(kv, {ReplyKind::Value, page(kv, 1001)}, std::numeric_limits<std::uint32_t>::max(), false);
    check(kv, {ReplyKind::Missing, page(kv, 0)}, 1, false);
    check(kv, {ReplyKind::Value, page(kv, 0, "", true)}, 1, false);
    check(kv, {ReplyKind::Value, page(kv, 0, "next", true)}, 1, true);
    // Cursor bytes cannot be credited as space for declared key/object fields.
    auto missing_fields = page(kv, 0, std::string(24000, 'x'));
    missing_fields[0] = 1;
    check(kv, {ReplyKind::Value, std::move(missing_fields)}, 1, false);
    auto trailing = page(kv, 0); trailing.push_back(0);
    check(kv, {ReplyKind::Value, std::move(trailing)}, 1, false);
  }
  Bytes wire;
  detail::append_field(wire, "abc");
  detail::WireReader reader(wire);
  assert(reader.remaining() == 7);
  std::string text;
  assert(reader.string(text) && text == "abc" && reader.remaining() == 0 && reader.done());
  std::uint32_t number;
  assert(!reader.u32(number) && reader.remaining() == 0);
  Bytes rows;
  detail::append_field(rows, std::string(256, 'm'));
  detail::append_u32(rows, 1);
  assert(!detail::decode_sql({ReplyKind::Value, rows}));
  detail::append_u32(rows, 1);
  assert(!detail::decode_sql({ReplyKind::Value, rows}));
  Bytes headers;
  detail::append_u32(headers, 1024);
  detail::append_u32(headers, std::numeric_limits<std::uint32_t>::max());
  headers.resize(headers.size() + 1024, 'a');
  assert(!detail::parse_headers(headers));
}
