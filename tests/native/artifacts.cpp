#include <cassert>
#include "cf/artifacts.hpp"
#include "cf/task.hpp"
static void u32(cf::Bytes& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
static cf::Bytes packet(std::string id = "id", std::string name = "owned", std::string branch = "main", bool read_only = false) {
  cf::Bytes bytes; u32(bytes, read_only ? 1 : 0);
  for (const auto& field : {id, name, branch}) { u32(bytes, static_cast<std::uint32_t>(field.size())); bytes.insert(bytes.end(), field.begin(), field.end()); }
  return bytes;
}
int main() {
  using namespace cf;
  OperationReply reply{ReplyKind::Value, packet()}; OperationCall observed{}; int calls = 0; bool fail = false;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call);
    if (fail) done(Result<OperationReply>::failure({ErrorCode::HostFailure, "not found"}));
    else done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Artifacts artifacts(runtime, "ARTIFACTS");
  auto handler = [&]() -> Task {
    auto value = co_await artifacts.info("owned");
    assert(value && value.value().id == "id" && value.value().name == "owned" && value.value().default_branch == "main" && !value.value().read_only);
    assert(observed.method == Operation::ArtifactsRepositoryInfo && observed.binding == "ARTIFACTS");
    assert(observed.key == "owned" && observed.body.empty() && observed.options == "5000");
    std::string name = "owned"; ArtifactsInfoOptions options{std::chrono::milliseconds(60000)};
    auto pending = artifacts.info(name, options); name = "changed"; options.timeout = std::chrono::milliseconds(0);
    assert(co_await pending); assert(observed.key == "owned" && observed.options == "60000");
    const int baseline = calls;
    for (const auto& invalid : std::vector<std::string>{"", ".", "..", "-name", "a/b", "a\n", "猫", std::string(1, '\0'), std::string(129, 'n'), std::string(1048576, 'n')}) {
      auto bad = co_await artifacts.info(invalid); assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    for (int timeout : {-1, 0, 60001}) {
      auto bad = co_await artifacts.info("owned", {std::chrono::milliseconds(timeout)});
      assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == baseline);
    const auto good = packet();
    for (std::size_t length = 0; length < good.size(); ++length) {
      reply.bytes.assign(good.begin(), good.begin() + length);
      auto bad = co_await artifacts.info("owned"); assert(!bad && bad.error().code == ErrorCode::HostFailure);
    }
    std::vector<Bytes> invalid{packet(""), packet("id", "other"), packet("id", "owned", ""),
      packet(std::string(129, 'i')), packet("id", "owned", std::string(257, 'b')),
      packet("\xff"), packet("id", "owned", "\xff"), Bytes(529)};
    auto boolean = good; boolean[0] = 2; invalid.push_back(boolean);
    auto trailing = good; trailing.push_back(0); invalid.push_back(trailing);
    for (const auto& bytes : invalid) {
      reply.bytes = bytes; auto bad = co_await artifacts.info("owned"); assert(!bad && bad.error().code == ErrorCode::HostFailure);
    }
    reply = {ReplyKind::Missing, good}; assert(!(co_await artifacts.info("owned")));
    reply = {ReplyKind::Value, packet("i", "n", "b")}; assert(reply.bytes.size() == 19); assert(co_await artifacts.info("n"));
    const auto maximum_name = std::string(128, 'n');
    reply.bytes = packet(std::string(128, 'i'), maximum_name, std::string(256, 'b'), true); assert(reply.bytes.size() == 528);
    auto maximum = co_await artifacts.info(maximum_name); assert(maximum && maximum.value().read_only && maximum.value().default_branch.size() == 256);
    const auto opaque = std::string("\xef\xbb\xbf猫") + '\0' + "owned";
    reply.bytes = packet(opaque, "Repo_1.git", opaque);
    auto owned = co_await artifacts.info("Repo_1.git"); reply.bytes.clear();
    assert(owned && owned.value().id == opaque && owned.value().default_branch == opaque);
    fail = true; auto failure = co_await artifacts.info("owned"); assert(!failure && failure.error().message == "not found");
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
