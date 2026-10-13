#include <cassert>
#include <type_traits>
#include "cf/subtle_crypto.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  static_assert(std::is_same_v<decltype(std::declval<SubtleCrypto>().sha256(Bytes{})), AsyncResult<std::array<std::uint8_t, 32>>>);
  static_assert(std::is_same_v<decltype(std::declval<SubtleCrypto>().sha384(Bytes{})), AsyncResult<std::array<std::uint8_t, 48>>>);
  static_assert(std::is_same_v<decltype(std::declval<SubtleCrypto>().sha512(Bytes{})), AsyncResult<std::array<std::uint8_t, 64>>>);
  int calls = 0;
  OperationReply next{ReplyKind::Value, Bytes(32, 42)};
  std::string algorithm = "SHA-256";
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::CryptoDigest && call.binding.empty() && call.options.empty());
    assert(call.key == algorithm);
    done(Result<OperationReply>::success(next));
  }, [](auto) {});
  SubtleCrypto crypto(runtime);
  auto handler = [&]() -> Task {
    auto valid = co_await crypto.sha256({});
    assert(valid && valid.value().front() == 42 && valid.value().back() == 42);
    next.bytes.resize(31);
    assert(!(co_await crypto.sha256({})));
    next.bytes.resize(33);
    assert(!(co_await crypto.sha256({})));
    next.bytes.resize(32);
    next.kind = ReplyKind::Missing;
    assert(!(co_await crypto.sha256({})));
    const int before = calls;
    Bytes oversized(1048577);
    auto invalid = co_await crypto.sha256(std::move(oversized));
    assert(!invalid && invalid.error().code == ErrorCode::InvalidInput && calls == before);
    next.kind = ReplyKind::Value;
    algorithm = "SHA-384"; next.bytes.resize(48);
    assert((co_await crypto.sha384({})));
    algorithm = "SHA-512"; next.bytes.resize(64);
    assert((co_await crypto.sha512({})));
    co_return Response{};
  };
  auto task = handler().take();
  task.resume();
  assert(task.done());
  task.destroy();
}
