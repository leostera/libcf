#include <cassert>
#include "cf/metadata.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  OperationReply next{ReplyKind::Value, {}};
  BindingRuntime runtime([&](OperationCall, BindingRuntime::Completion done) {
    done(Result<OperationReply>::success(next));
  }, [](auto) {});
  const auto field = [&](std::string_view value) {
    for (unsigned shift = 0; shift < 32; shift += 8) next.bytes.push_back(static_cast<std::uint8_t>(value.size() >> shift));
    next.bytes.insert(next.bytes.end(), value.begin(), value.end());
  };
  VersionMetadata metadata(runtime, "VERSION");
  SecretsStoreSecret secret(runtime, "SECRET");
  auto handler = [&]() -> Task {
    field("version-id"); field(""); field("2026-10-13T12:00:00Z");
    auto version = co_await metadata.get();
    assert(version && version.value().id == "version-id" && version.value().tag.empty());
    next.bytes.push_back(0);
    assert(!(co_await metadata.get()));
    next.bytes.clear();
    auto empty = co_await secret.get();
    assert(empty && empty.value().empty());
    next.bytes = Bytes{'a', 0, 'b'};
    auto binary = co_await secret.get();
    assert(binary && binary.value() == std::string("a\0b", 3));
    next.kind = ReplyKind::Missing;
    assert(!(co_await secret.get()));
    next.kind = ReplyKind::Value;
    next.bytes.resize(65537);
    assert(!(co_await secret.get()));
    co_return Response{};
  };
  auto task = handler().take();
  task.resume();
  assert(task.done());
  task.destroy();
}
