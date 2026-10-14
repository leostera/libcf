#include <cassert>
#include "cf/container.hpp"
#include "cf/task.hpp"
static void u32(cf::Bytes& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}
static void text(cf::Bytes& bytes, const std::string& value) {
  u32(bytes, static_cast<std::uint32_t>(value.size())); bytes.insert(bytes.end(), value.begin(), value.end());
}
static cf::Bytes packet(std::string image = "", std::vector<cf::ContainerLabel> labels = {{"owner", "libcf"}}) {
  cf::Bytes bytes; u32(bytes, 1); text(bytes, image); u32(bytes, static_cast<std::uint32_t>(labels.size()));
  for (const auto& label : labels) { text(bytes, label.name); text(bytes, label.value); }
  return bytes;
}
int main() {
  using namespace cf;
  OperationReply reply{ReplyKind::Value, packet()}; OperationCall observed{}; int calls = 0;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls; observed = std::move(call); done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  Container container(runtime);
  auto handler = [&]() -> Task {
    auto value = co_await container.inspect();
    assert(value && value.value() && value.value()->image.empty() && value.value()->labels[0].name == "owner");
    assert(observed.method == Operation::ContainerInspect && observed.binding == "__LIBCF_DO_CONTAINER");
    assert(observed.key.empty() && observed.body.empty() && observed.options == "5000");
    ContainerInspectOptions options{std::chrono::milliseconds(60000)};
    auto pending = container.inspect(options); options.timeout = std::chrono::milliseconds(0);
    assert(co_await pending); assert(observed.options == "60000");
    const int baseline = calls;
    for (int timeout : {-1, 0, 60001}) {
      auto bad = co_await container.inspect({std::chrono::milliseconds(timeout)});
      assert(!bad && bad.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == baseline);
    const auto good = packet();
    for (std::size_t length = 0; length < good.size(); ++length) {
      reply.bytes.assign(good.begin(), good.begin() + length);
      auto bad = co_await container.inspect(); assert(!bad && bad.error().code == ErrorCode::HostFailure);
    }
    std::vector<Bytes> invalid{packet(std::string(2049, 'i')), packet("\xff"), packet("", {{"", ""}}),
      packet("", {{std::string(17, 'n'), ""}}), packet("", {{"n", std::string(65, 'v')}}),
      packet("", {{"n", "one"}, {"n", "two"}}), packet("", {{"\xff", ""}}), packet("", {{"n", "\xff"}}),
      Bytes(2941), Bytes{2, 0, 0, 0}, Bytes{0, 0, 0, 0, 1}};
    auto trailing = good; trailing.push_back(0); invalid.push_back(trailing);
    auto count = packet("", {}); count[8] = 11; invalid.push_back(count);
    for (const auto& control : std::vector<std::string>{std::string(1, '\0'), "\x1f", "\x7f", "\xc2\x80", "\xc2\x9f"}) {
      invalid.push_back(packet("", {{control, ""}})); invalid.push_back(packet("", {{"n", control}}));
    }
    for (const auto& bytes : invalid) {
      reply.bytes = bytes; auto bad = co_await container.inspect(); assert(!bad && bad.error().code == ErrorCode::HostFailure);
    }
    reply = {ReplyKind::Missing, good}; assert(!(co_await container.inspect()));
    reply = {ReplyKind::Value, Bytes(4)}; auto absent = co_await container.inspect(); assert(absent && !absent.value());
    reply.bytes = packet("", {}); auto empty = co_await container.inspect(); assert(empty && empty.value() && empty.value()->labels.empty());
    std::vector<ContainerLabel> labels;
    for (int i = 0; i < 10; ++i) labels.push_back({std::string(15, 'k') + std::to_string(i), std::string(64, 'v')});
    reply.bytes = packet(std::string(2048, 'i'), labels); assert(reply.bytes.size() == 2940);
    auto maximum = co_await container.inspect(); assert(maximum && maximum.value()->labels.size() == 10);
    const auto image = std::string("\xef\xbb\xbf猫") + '\0' + "image";
    reply.bytes = packet(image, {{"__proto__", ""}, {"猫", "\xef\xbb\xbfowned"}, {"noncontrol", "\xc2\xa0"}});
    auto owned = co_await container.inspect(); reply.bytes.clear();
    assert(owned && owned.value()->image == image && owned.value()->labels[0].value.empty());
    assert(owned.value()->labels[1].value == "\xef\xbb\xbfowned");
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
