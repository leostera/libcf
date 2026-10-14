#include <cassert>
#include "cf/sites.hpp"
#include "cf/task.hpp"
int main() {
  using namespace cf;
  OperationReply response{ReplyKind::Value, {0, 255, 128}}; OperationCall observed{}; int calls = 0; bool fail = false;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    if (fail) done(Result<OperationReply>::failure({ErrorCode::HostFailure, "provider failure"}));
    else done(Result<OperationReply>::success(response));
  }, [](auto) {});
  LegacySites sites(runtime);
  auto handler = [&]() -> Task {
    auto result = co_await sites.get_bytes("index.txt"); assert(result && result.value() && *result.value() == response.bytes);
    assert(observed.method == Operation::LegacySitesGet && observed.binding == "__STATIC_CONTENT" && observed.key == "index.txt" && observed.body.empty() && observed.options == "5000");
    std::string key = "space 猫.bin"; LegacySitesReadOptions options{std::chrono::milliseconds(60000)};
    auto pending = sites.get_bytes(key, options); key = "changed"; options.timeout = std::chrono::milliseconds(0);
    assert(co_await pending); assert(observed.key == "space 猫.bin" && observed.options == "60000");
    response.bytes.clear(); result = co_await sites.get_bytes("empty"); assert(result && result.value() && result.value()->empty());
    response.kind = ReplyKind::Missing; result = co_await sites.get_bytes("absent"); assert(result && !result.value());
    response.bytes = {1}; result = co_await sites.get_bytes("absent"); assert(!result && result.error().code == ErrorCode::HostFailure);
    response = {static_cast<ReplyKind>(99), {}}; assert(!(co_await sites.get_bytes("index.txt")));
    response = {ReplyKind::Value, Bytes(1048576, 255)}; result = co_await sites.get_bytes("maximum"); response.bytes.clear(); assert(result && result.value() && result.value()->size() == 1048576 && result.value()->back() == 255);
    response.bytes.resize(1048577); assert(!(co_await sites.get_bytes("oversized"))); response.bytes.clear();
    std::string unicode; for (int i = 0; i < 170; ++i) unicode += "猫"; unicode += "ab"; assert(unicode.size() == 512);
    for (const auto& valid : std::vector<std::string>{"a", "dir/file", "a..b", "space 猫.bin", "__proto__", "constructor", std::string(512, 'x'), unicode, "\xc2\xa0"}) assert(co_await sites.get_bytes(valid, {std::chrono::milliseconds(1)}));
    const int baseline = calls;
    for (const auto& invalid : std::vector<std::string>{"", "/", "/a", "a/", "a//b", ".", "..", "a/./b", "a/../b", "a\\b", "a:b", "a%20b", "a?b", "a#b", " a", "a ", "a/ b", "a /b", "a\n", std::string("a\0b", 3), "\xc2\x80", "\xc2\x9f", "\x7f", "\xef\xbb\xbf", "\xed\xa0\x80", "\xff", std::string(513, 'x'), unicode + "x"}) {
      auto bad = co_await sites.get_bytes(invalid); assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    for (int timeout : {-1, 0, 60001}) assert(!(co_await sites.get_bytes("index.txt", {std::chrono::milliseconds(timeout)})));
    assert(calls == baseline);
    LegacySites alternate(runtime, "OWNED_NAMESPACE"); assert(co_await alternate.get_bytes("index.txt")); assert(observed.binding == "OWNED_NAMESPACE");
    fail = true; result = co_await sites.get_bytes("index.txt"); assert(!result && result.error().message == "provider failure");
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
