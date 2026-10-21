#include <cassert>
#include <optional>
#include <type_traits>

#include "cf/subtle_crypto.hpp"
#include "cf/task.hpp"

namespace {
using namespace cf;

// Records each start; completes inline or later, as each test chooses.
struct FakeDigests final : DigestHost {
  mutable int starts = 0;
  mutable int detached = 0;
  mutable DigestAlgorithm algorithm{};
  mutable std::size_t input_size = 0;
  mutable DigestWaiter* waiter = nullptr;
  std::optional<Bytes> inline_reply;  // complete inside start() when set
  std::uint32_t start(int invocation, DigestAlgorithm value, std::span<const std::uint8_t> input,
                      DigestWaiter& target) const override {
    assert(invocation == 7);
    ++starts;
    algorithm = value;
    input_size = input.size();
    if (inline_reply) {
      target.digest_complete(Result<std::span<const std::uint8_t>>::success(*inline_reply));
      return 0;
    }
    waiter = &target;
    return 99;
  }
  void detach(std::uint32_t ticket) const override {
    assert(ticket == 99);
    ++detached;
    waiter = nullptr;
  }
};

void complete(FakeDigests& host, Result<std::span<const std::uint8_t>> result) {
  auto* waiter = std::exchange(host.waiter, nullptr);
  assert(waiter);
  waiter->digest_complete(std::move(result));
}
}  // namespace

int main() {
  static_assert(std::is_same_v<decltype(std::declval<SubtleCrypto>().sha256(Bytes{})), DigestOperation<32>>);
  static_assert(std::is_same_v<decltype(std::declval<SubtleCrypto>().sha384(Bytes{})), DigestOperation<48>>);
  static_assert(std::is_same_v<decltype(std::declval<SubtleCrypto>().sha512(Bytes{})), DigestOperation<64>>);
  static_assert(!std::is_copy_constructible_v<DigestOperation<32>>);
  static_assert(!std::is_move_constructible_v<DigestOperation<32>>);

  FakeDigests host;
  int resumes = 0;
  std::coroutine_handle<> root;
  BindingRuntime runtime([](OperationCall, BindingRuntime::Completion) { assert(false); },
                         [&](std::coroutine_handle<>) { ++resumes; root.resume(); },
                         DigestRoute{&host, 7});
  SubtleCrypto crypto(runtime);
  const Bytes input(5, 1);
  const Bytes reply32(32, 42), reply48(48, 1), short31(31, 0);

  auto handler = [&]() -> Task {
    // Inline completion resumes without going through the runtime.
    host.inline_reply = reply32;
    auto inline_result = co_await crypto.sha256(input);
    assert(inline_result && inline_result.value().front() == 42 && resumes == 0);
    assert(host.algorithm == DigestAlgorithm::Sha256 && host.input_size == 5);
    host.inline_reply.reset();

    // Asynchronous completion resumes through the runtime's Resume.
    auto later = co_await crypto.sha384(bytes_of("abc"));
    assert(later && later.value().size() == 48 && host.algorithm == DigestAlgorithm::Sha384);

    auto wrong_size = co_await crypto.sha512(input);
    assert(!wrong_size && wrong_size.error().code == ErrorCode::HostFailure);

    auto failed = co_await crypto.sha256(input);
    assert(!failed && failed.error().message == "boom");

    const int before = host.starts;
    const Bytes oversized(kMaxDigestInput + 1);
    auto invalid = co_await crypto.sha256(oversized);
    assert(!invalid && invalid.error().code == ErrorCode::InvalidInput && host.starts == before);

    auto pending = co_await crypto.sha256(input);  // destroyed while suspended below
    (void)pending;
    co_return Response{};
  };
  auto task = handler().take();
  root = task;
  task.resume();
  assert(!task.done());
  complete(host, Result<std::span<const std::uint8_t>>::success(reply48));
  complete(host, Result<std::span<const std::uint8_t>>::success(short31));
  complete(host, Result<std::span<const std::uint8_t>>::failure({ErrorCode::HostFailure, "boom"}));
  // Now suspended on the final digest: destroying the frame detaches it.
  assert(host.waiter && host.detached == 0);
  task.destroy();
  assert(host.detached == 1 && host.waiter == nullptr);

  // Without a digest host, operations fail without starting.
  SubtleCrypto unrouted(BindingRuntime([](OperationCall, BindingRuntime::Completion) {}, [](auto) {}));
  auto orphan = [&]() -> Task {
    auto result = co_await unrouted.sha256(input);
    assert(!result && result.error().code == ErrorCode::MissingBinding);
    co_return Response{};
  };
  auto orphan_task = orphan().take();
  orphan_task.resume();
  assert(orphan_task.done());
  orphan_task.destroy();
}
