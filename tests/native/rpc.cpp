#include <cassert>
#include <string>
#include "cf/rpc.hpp"
#include "cf/task.hpp"

int main() {
  cf::OperationCall last;
  cf::OperationReply reply{cf::ReplyKind::Value, {'4', '2'}};
  int calls = 0;
  cf::BindingRuntime runtime([&](auto request, auto done) {
    ++calls; last = std::move(request);
    done(cf::Result<cf::OperationReply>::success(reply));
  }, [](auto handle) { handle.resume(); });
  cf::RpcService service(runtime, "REFERENCE");
  auto finish = [](cf::Task task) {
    auto handle = task.take(); handle.resume(); assert(handle.done()); handle.destroy();
  };
  auto success = [&]() -> cf::Task {
    auto result = co_await service.call_json("sum", "[20,22]");
    assert(result && result.value() == "42");
    co_return cf::Response::text("ok");
  };
  finish(success());
  assert(calls == 1 && last.method == cf::Operation::RpcCallJson && last.binding == "REFERENCE");
  assert(last.key == "sum" && last.options.empty());
  assert(std::string(last.body.begin(), last.body.end()) == "[20,22]");
  for (const std::string name : {std::string{}, std::string("_private"), std::string("a\n"), std::string(101, 'a')}) {
    auto invalid = [&]() -> cf::Task {
      auto result = co_await service.call_json(name);
      assert(!result && result.error().code == cf::ErrorCode::InvalidInput);
      co_return cf::Response::text("rejected");
    };
    finish(invalid());
  }
  for (const auto& args : {std::string{}, std::string(1048577, 'x')}) {
    auto invalid = [&]() -> cf::Task {
      auto result = co_await service.call_json("echo", args);
      assert(!result); co_return cf::Response::text("rejected");
    };
    finish(invalid());
  }
  assert(calls == 1);
  const std::string exact = "[\"" + std::string(1048572, 'x') + "\"]";
  auto boundary = [&]() -> cf::Task {
    auto result = co_await service.call_json(std::string(100, 'a'), exact);
    assert(result && last.body.size() == 1048576);
    co_return cf::Response::text("accepted");
  };
  finish(boundary());
  for (auto malformed : {cf::OperationReply{cf::ReplyKind::Missing, {'4', '2'}},
    cf::OperationReply{cf::ReplyKind::Value, {}},
    cf::OperationReply{cf::ReplyKind::Value, cf::Bytes(1048577, 'x')}}) {
    reply = std::move(malformed);
    auto rejected = [&]() -> cf::Task {
      auto result = co_await service.call_json("echo");
      assert(!result); co_return cf::Response::text("rejected");
    };
    finish(rejected());
  }
}
