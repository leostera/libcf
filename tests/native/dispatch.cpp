#include <cassert>
#include "cf/dispatch.hpp"
#include "cf/task.hpp"

static void field(cf::Bytes& wire, std::string_view value) {
  auto size = static_cast<std::uint32_t>(value.size());
  for (unsigned shift = 0; shift < 32; shift += 8) wire.push_back(static_cast<std::uint8_t>(size >> shift));
  wire.insert(wire.end(), value.begin(), value.end());
}
static cf::Bytes response(std::string_view status, std::string_view headers, std::string_view body) {
  cf::Bytes bytes; field(bytes, status); field(bytes, headers); field(bytes, body); return bytes;
}
int main() {
  using namespace cf;
  int calls = 0;
  OperationCall observed{};
  bool fail = false;
  OperationReply reply{ReplyKind::Value, response("201", "", std::string("\0\xff", 2))};
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    if (fail) done(Result<OperationReply>::failure({ErrorCode::HostFailure, "lookup failed"}));
    else done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  DispatchNamespace dispatch(runtime, "DISPATCHER");
  auto handler = [&]() -> Task {
    Request request; request.method = "POST"; request.url = "https://user.example.test/";
    request.body = std::string("\0\xff", 2);
    DispatchTarget target{"example"};
    auto pending = dispatch.fetch(target, request);
    target.worker = "changed"; request.body = "changed";
    auto result = co_await pending;
    assert(result && result.value().status == 201 && std::get<std::string>(result.value().body) == std::string("\0\xff", 2));
    assert(observed.method == Operation::DispatchFetch && observed.binding == "DISPATCHER");
    assert(observed.options == "example:50:0" && observed.key == request.url);
    detail::WireReader reader(observed.body);
    std::string method, headers, body;
    assert(reader.string(method) && reader.string(headers) && reader.string(body) && reader.done());
    assert(method == "POST" && body == std::string("\0\xff", 2));
    const std::vector<DispatchTarget> invalid{
      {""}, {"bad\n"}, {std::string(64, 'a')}, {"bad.name"},
      {"example", {std::chrono::milliseconds(0), 0}},
      {"example", {std::chrono::milliseconds(30001), 0}},
      {"example", {std::chrono::milliseconds(50), 1001}},
    };
    for (auto input : invalid) {
      auto rejected = co_await dispatch.fetch(std::move(input), request);
      assert(!rejected && rejected.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == 1);
    request.body.assign(1048577, 'x');
    assert(!(co_await dispatch.fetch({"example"}, request)) && calls == 1);
    request.body.clear(); request.method.assign(33, 'A');
    assert(!(co_await dispatch.fetch({"example"}, request)) && calls == 1);
    request.method = "GET";
    for (auto bytes : std::vector<Bytes>{Bytes{}, response("101", "", ""),
        response("200", "", std::string(1048577, 'x')), response("200", std::string(65537, 'x'), ""),
        Bytes(1048576 + 65536 + 16)}) {
      reply.bytes = std::move(bytes);
      assert(!(co_await dispatch.fetch({"example"}, request)));
    }
    reply.bytes = response("200", "", "ok");
    request.method = "POST";
    request.body.assign(1048576 - 16, 'x');
    assert(co_await dispatch.fetch({"example"}, request));
    assert(observed.body.size() == 1048576);
    const auto before_overflow = calls;
    request.body.push_back('x');
    assert(!(co_await dispatch.fetch({"example"}, request)) && calls == before_overflow);
    request.body.clear();
    fail = true;
    auto failure = co_await dispatch.fetch({"example"}, request);
    assert(!failure && failure.error().code == ErrorCode::HostFailure);
    fail = false;
    reply.bytes = response("302", "", "redirect");
    auto recovered = co_await dispatch.fetch({std::string(63, 'a'), {std::chrono::milliseconds(30000), 1000}}, request);
    assert(recovered && recovered.value().status == 302);
    co_return Response::text("ok");
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
