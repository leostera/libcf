#include <cassert>
#include "cf/ai_gateway.hpp"
#include "cf/task.hpp"
static std::string endpoint(std::string id = "owned", std::string provider = "", std::string account = "synthetic-account") {
  return "https://gateway.ai.cloudflare.com/v1/" + account + "/" + id + "/" + provider;
}
static cf::OperationReply reply(std::string url) { return {cf::ReplyKind::Value, cf::Bytes(url.begin(), url.end())}; }
int main() {
  using namespace cf;
  auto response = reply(endpoint()); OperationCall observed{}; int calls = 0; bool fail = false;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    if (fail) done(Result<OperationReply>::failure({ErrorCode::HostFailure, "lookup failed"}));
    else done(Result<OperationReply>::success(response));
  }, [](auto) {});
  AiGateway gateway(runtime, "AI");
  auto handler = [&]() -> Task {
    auto result = co_await gateway.lookup_url("owned"); assert(result && result.value().url == endpoint());
    assert(observed.method == Operation::AiGatewayUrl && observed.binding == "AI" && observed.key == "owned" && observed.body.empty() && observed.options == "5000");
    std::string id = "owned"; AiGatewayUrlOptions options{std::string("openai"), std::chrono::milliseconds(60000)};
    auto pending = gateway.lookup_url(id, options); id = "changed"; options.provider = "changed"; options.timeout = std::chrono::milliseconds(0);
    response = reply(endpoint("owned", "openai")); result = co_await pending; assert(result && result.value().url == endpoint("owned", "openai"));
    assert(observed.key == "owned" && observed.options == "60000" && std::string(observed.body.begin(), observed.body.end()) == "openai");
    response = reply(endpoint()); assert(co_await gateway.lookup_url("owned", {std::string("universal")}));
    assert(std::string(observed.body.begin(), observed.body.end()) == "universal");
    response = reply(endpoint("default")); assert(co_await gateway.lookup_url("default"));
    response = reply(endpoint("g", "", "a")); assert(response.bytes.size() == 41); assert(co_await gateway.lookup_url("g", {std::nullopt, std::chrono::milliseconds(1)}));
    const std::string max_id(64, 'g'), max_provider(64, 'p');
    const auto maximum = endpoint(max_id, max_provider, std::string(128, 'a'));
    response = reply(maximum); assert(response.bytes.size() == 295);
    result = co_await gateway.lookup_url(max_id, {max_provider}); response.bytes.clear(); assert(result && result.value().url == maximum);
    const int baseline = calls;
    for (const auto& bad : std::vector<std::string>{"", "Upper", "-leading", "a/b", "a?b", "a.b", "a%2fb", "a\n", "猫", std::string("a\0b", 3), std::string(65, 'a'), std::string(1048576, 'a')}) {
      auto invalid = co_await gateway.lookup_url(bad); assert(!invalid && invalid.error().code == ErrorCode::InvalidInput);
      invalid = co_await gateway.lookup_url("owned", {bad}); assert(!invalid && invalid.error().code == ErrorCode::InvalidInput);
    }
    for (int timeout : {-1, 0, 60001}) assert(!(co_await gateway.lookup_url("owned", {std::nullopt, std::chrono::milliseconds(timeout)})));
    assert(calls == baseline);
    const auto good = endpoint("owned", "openai");
    for (std::size_t n = 0; n < good.size(); ++n) { response = reply(good.substr(0, n)); auto invalid = co_await gateway.lookup_url("owned", {std::string("openai")}); assert(!invalid && invalid.error().code == ErrorCode::HostFailure); }
    for (const auto& bad : std::vector<std::string>{
      endpoint("other"), endpoint("owned", "openai"), endpoint("owned", "", ""), endpoint("owned", "", ".."),
      endpoint("owned", "", "a%2fb"), endpoint("owned", "", "a\n"), endpoint("owned", "", std::string(129, 'a')),
      endpoint("owned", "", "猫"), endpoint("owned", "", std::string("a\0b", 3)), endpoint("owned", "", "a:b"),
      "http://gateway.ai.cloudflare.com/v1/a/owned/", "https://other.ai.cloudflare.com/v1/a/owned/",
      "https://secret@gateway.ai.cloudflare.com/v1/a/owned/", "https://gateway.ai.cloudflare.com:443/v1/a/owned/",
      "https://gateway.ai.cloudflare.com/v1//a/owned/", endpoint().substr(0, endpoint().size() - 1),
      endpoint() + "?key=secret", endpoint() + "#fragment", endpoint() + "\n", endpoint() + '\0', std::string(296, 'x')}) {
      response = reply(bad); auto invalid = co_await gateway.lookup_url("owned"); assert(!invalid && invalid.error().code == ErrorCode::HostFailure);
    }
    response = reply(endpoint()); response.kind = ReplyKind::Missing; assert(!(co_await gateway.lookup_url("owned")));
    response = reply(endpoint("owned", "", "NOT-AN-OWNERSHIP-PROOF")); assert(co_await gateway.lookup_url("owned"));
    fail = true; auto failure = co_await gateway.lookup_url("owned"); assert(!failure && failure.error().message == "lookup failed");
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
