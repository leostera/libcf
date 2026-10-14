#include <cassert>
#include <type_traits>
#include "cf/outbound_http.hpp"
#include "cf/task.hpp"
static_assert(!std::is_same_v<cf::MtlsHttp, cf::VpcServiceHttp>);
static_assert(!std::is_same_v<cf::VpcServiceHttp, cf::VpcNetworkHttp>);
static_assert(!std::is_same_v<cf::MtlsHttp, cf::VpcNetworkHttp>);

template <class Client>
static void check(cf::Operation operation) {
  using namespace cf;
  OperationReply response{ReplyKind::Value, {0, 255, 128}}; OperationCall observed{}; int calls = 0; bool fail = false;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    if (fail) done(Result<OperationReply>::failure({ErrorCode::HostFailure, "provider failure"}));
    else done(Result<OperationReply>::success(response));
  }, [](auto) {});
  Client client(runtime, "OWNED");
  auto handler = [&]() -> Task {
    auto result = co_await client.get_bytes("health"); assert(result && result.value() == response.bytes);
    assert(observed.method == operation && observed.binding == "OWNED" && observed.key == "health" && observed.body.empty() && observed.options == "5000");
    std::string name = "health"; BoundHttpsGetOptions options{std::chrono::milliseconds(60000)};
    auto pending = client.get_bytes(name, options); name = "changed"; options.timeout = std::chrono::milliseconds(0);
    assert(co_await pending); assert(observed.key == "health" && observed.options == "60000");
    Client replaceable(runtime, "OWNED"); auto bound = replaceable.get_bytes("health"); replaceable = Client(runtime, "OTHER");
    assert(co_await bound); assert(observed.binding == "OWNED");
    response.bytes.clear(); result = co_await client.get_bytes("empty"); assert(result && result.value().empty());
    response.bytes.resize(1048576, 7); result = co_await client.get_bytes("maximum"); response.bytes.clear(); assert(result && result.value().size() == 1048576 && result.value().back() == 7);
    response.bytes.resize(1048577); assert(!(co_await client.get_bytes("oversized"))); response.bytes.clear();
    for (auto kind : {ReplyKind::Missing, static_cast<ReplyKind>(99)}) { response.kind = kind; auto bad = co_await client.get_bytes("health"); assert(!bad && bad.error().code == ErrorCode::HostFailure); }
    response.kind = ReplyKind::Value;
    Client max_binding(runtime, std::string(64, 'A')); assert(co_await max_binding.get_bytes(std::string(64, 'a'), {std::chrono::milliseconds(1)}));
    assert(observed.binding.size() == 64 && observed.key.size() == 64 && observed.options == "1");
    assert(co_await Client(runtime, "A_09").get_bytes("a-09"));
    const int baseline = calls;
    for (const auto& bad : std::vector<std::string>{"", "Upper", "-a", "a_b", "a/b", "https://owned.invalid/", "a?b", "a#b", "a\n", "猫", "\xff", std::string("a\0b", 3), std::string(65, 'a'), std::string(1048576, 'a')}) {
      auto invalid = co_await client.get_bytes(bad); assert(!invalid && invalid.error().code == ErrorCode::InvalidInput);
    }
    for (const auto& bad : std::vector<std::string>{"", "lower", "_A", "A-B", "A/B", "A\n", "猫", std::string(65, 'A')}) { Client invalid(runtime, bad); assert(!(co_await invalid.get_bytes("health"))); }
    for (int timeout : {-1, 0, 60001}) assert(!(co_await client.get_bytes("health", {std::chrono::milliseconds(timeout)})));
    assert(calls == baseline);
    fail = true; result = co_await client.get_bytes("health"); assert(!result && result.error().message == "provider failure");
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
int main() {
  check<cf::MtlsHttp>(cf::Operation::MtlsGet);
  check<cf::VpcServiceHttp>(cf::Operation::VpcServiceGet);
  check<cf::VpcNetworkHttp>(cf::Operation::VpcNetworkGet);
}
