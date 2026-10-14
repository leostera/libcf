#include <cassert>
#include "cf/ai_search.hpp"
#include "cf/task.hpp"

static void u32(cf::Bytes& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
static void string(cf::Bytes& bytes, const std::string& value) {
  u32(bytes, static_cast<std::uint32_t>(value.size()));
  bytes.insert(bytes.end(), value.begin(), value.end());
}
static cf::Bytes reply_bytes(std::string id, double score, std::string key, std::string text) {
  cf::Bytes bytes;
  u32(bytes, 1); string(bytes, id);
  const auto bits = std::bit_cast<std::uint64_t>(score);
  u32(bytes, static_cast<std::uint32_t>(bits)); u32(bytes, static_cast<std::uint32_t>(bits >> 32));
  string(bytes, key); string(bytes, text);
  return bytes;
}
int main() {
  using namespace cf;
  using namespace std::string_literals;
  int calls = 0;
  OperationCall observed{};
  OperationReply reply{ReplyKind::Value, reply_bytes("\xef\xbb\xbf猫", 0.75, "docs/猫", "hello\0猫"s)};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  AiSearch search(runtime, "SEARCH");
  auto handler = [&]() -> Task {
    AiSearchKeywordQuery input{"\xef\xbb\xbf猫", 5, std::chrono::milliseconds(100)};
    auto pending = search.keyword_search(input);
    input.text = "changed";
    auto result = co_await pending;
    assert(result && result.value().size() == 1);
    const auto& match = result.value()[0];
    assert(match.id == "\xef\xbb\xbf猫" && match.score == 0.75);
    assert(match.source_key == "docs/猫" && match.text == "hello\0猫"s);
    assert(observed.method == Operation::AiSearchKeywordQuery && observed.binding == "SEARCH");
    assert(observed.key.empty() && observed.options == "5:100");
    assert(std::string(observed.body.begin(), observed.body.end()) == "\xef\xbb\xbf猫");
    const std::vector<std::string> bad_utf8{
      "\x80", "\xc0\x80", "\xc1\xbf", "\xc2", "\xc2x", "\xe0\x80\x80",
      "\xed\xa0\x80", "\xed\xbf\xbf", "\xf0\x80\x80\x80", "\xf4\x90\x80\x80",
      "\xf5\x80\x80\x80", "\xff", "\xf0\x90\x80",
    };
    std::vector<AiSearchKeywordQuery> invalid{
      {""}, {std::string(4097, 'x')}, {"x", 0}, {"x", 51},
      {"x", 1, std::chrono::milliseconds(0)}, {"x", 1, std::chrono::milliseconds(60001)},
    };
    for (const auto& text : bad_utf8) invalid.push_back({text});
    for (const auto& request : invalid) {
      auto rejected = co_await search.keyword_search(request);
      assert(!rejected && rejected.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == 1);
    const auto good = reply.bytes;
    for (std::size_t length = 0; length < good.size(); ++length) {
      reply.bytes.assign(good.begin(), good.begin() + length);
      assert(!(co_await search.keyword_search({"x", 1})));
    }
    for (auto bytes : std::vector<Bytes>{Bytes{2,0,0,0}, Bytes{255,255,255,255},
        reply_bytes("", 0, "k", "t"), reply_bytes(std::string(257, 'i'), 0, "k", "t"),
        reply_bytes("i", 0, "", "t"), reply_bytes("i", 0, std::string(2049, 'k'), "t"),
        reply_bytes("i", 0, "k", std::string(16385, 't')),
        reply_bytes("i", -0.1, "k", "t"), reply_bytes("i", 1.1, "k", "t"),
        reply_bytes("i", std::numeric_limits<double>::quiet_NaN(), "k", "t"),
        reply_bytes("i", std::numeric_limits<double>::infinity(), "k", "t"), Bytes(935405)}) {
      reply.bytes = std::move(bytes);
      assert(!(co_await search.keyword_search({"x", 1})));
    }
    for (const auto& text : bad_utf8) {
      for (auto bytes : {reply_bytes(text, 0, "k", "t"), reply_bytes("i", 0, text, "t"), reply_bytes("i", 0, "k", text)}) {
        reply.bytes = std::move(bytes);
        assert(!(co_await search.keyword_search({"x", 1})));
      }
    }
    reply.bytes = good; reply.bytes.push_back(0);
    assert(!(co_await search.keyword_search({"x", 1})));
    reply = {ReplyKind::Missing, good};
    assert(!(co_await search.keyword_search({"x", 1})));
    reply = {ReplyKind::Value, Bytes(4)};
    for (const auto& text : std::vector<std::string>{"\0"s, "\x7f", "\xc2\x80", "\xdf\xbf", "\xe0\xa0\x80",
        "\xed\x9f\xbf", "\xee\x80\x80", "\xf0\x90\x80\x80", "\xf4\x8f\xbf\xbf"}) {
      assert(co_await search.keyword_search({text, 1}));
    }
    auto empty = co_await search.keyword_search({std::string(4096, 'x'), 50, std::chrono::milliseconds(60000)});
    assert(empty && empty.value().empty());
    const auto largest = reply_bytes(std::string(256, 'i'), 1, std::string(2048, 'k'), std::string(16384, 't'));
    reply.bytes.clear(); u32(reply.bytes, 50);
    for (unsigned i = 0; i < 50; ++i) reply.bytes.insert(reply.bytes.end(), largest.begin() + 4, largest.end());
    assert(reply.bytes.size() == 935404);
    auto maximum = co_await search.keyword_search({"x", 50});
    assert(maximum && maximum.value().size() == 50);
    reply.bytes = reply_bytes("owned", 0.123456789012345, "key", "");
    auto recovered = co_await search.keyword_search({"x", 1});
    reply.bytes.clear();
    assert(recovered && recovered.value()[0].id == "owned" && recovered.value()[0].text.empty());
    assert(recovered.value()[0].score == 0.123456789012345);
    co_return Response::text("ok");
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
