#pragma once

#include <algorithm>
#include <array>
#include <coroutine>
#include <cstddef>
#include <optional>
#include <span>
#include <string_view>

#include "cf/operation.hpp"

namespace cf {

inline constexpr std::size_t kMaxDigestInput = 1024 * 1024;

// Views text as bytes, for example to digest a request body without copying it.
[[nodiscard]] inline std::span<const std::uint8_t> bytes_of(std::string_view text) noexcept {
  return {reinterpret_cast<const std::uint8_t*>(text.data()), text.size()};
}

// One borrowed-input digest. The input is read when the operation is awaited,
// so it must stay valid until then (a temporary in the same co_await expression
// is fine). The operation allocates nothing and is neither copyable nor movable.
template <std::size_t Size>
class [[nodiscard]] DigestOperation final : private DigestWaiter {
 public:
  using Digest = std::array<std::uint8_t, Size>;

  DigestOperation(DigestRoute route, BindingRuntime::Resume resume, DigestAlgorithm algorithm,
                  std::span<const std::uint8_t> input)
      : route_(route), resume_(std::move(resume)), algorithm_(algorithm), input_(input) {
    if (input.size() > kMaxDigestInput)
      result_ = Result<Digest>::failure({ErrorCode::InvalidInput, "digest input exceeds 1 MiB"});
    else if (route.host == nullptr)
      result_ = Result<Digest>::failure({ErrorCode::MissingBinding, "digest host unavailable"});
  }
  DigestOperation(const DigestOperation&) = delete;
  DigestOperation& operator=(const DigestOperation&) = delete;
  ~DigestOperation() {
    if (ticket_ != 0) route_.host->detach(ticket_);
  }

  bool await_ready() const noexcept { return result_.has_value(); }
  bool await_suspend(std::coroutine_handle<> handle) {
    handle_ = handle;
    suspending_ = true;
    const auto ticket = route_.host->start(route_.invocation, algorithm_, input_, *this);
    suspending_ = false;
    // An inline completion must not resume recursively from inside await_suspend.
    if (result_) return false;
    ticket_ = ticket;
    return true;
  }
  Result<Digest> await_resume() { return std::move(*result_); }

 private:
  void digest_complete(Result<std::span<const std::uint8_t>> digest) override {
    ticket_ = 0;
    if (!digest) {
      result_ = Result<Digest>::failure(std::move(digest.error()));
    } else if (digest.value().size() != Size) {
      result_ = Result<Digest>::failure({ErrorCode::HostFailure, "invalid digest reply"});
    } else {
      Digest value;
      std::copy(digest.value().begin(), digest.value().end(), value.begin());
      result_ = Result<Digest>::success(value);
    }
    // Last action: resuming may destroy this awaitable.
    if (!suspending_) resume_(handle_);
  }

  DigestRoute route_;
  BindingRuntime::Resume resume_;
  DigestAlgorithm algorithm_;
  std::span<const std::uint8_t> input_;
  std::optional<Result<Digest>> result_;
  std::coroutine_handle<> handle_;
  std::uint32_t ticket_ = 0;
  bool suspending_ = false;
};

class SubtleCrypto {
 public:
  explicit SubtleCrypto(const BindingRuntime& runtime)
      : route_(runtime.digest_route()), resume_(runtime.resume()) {}

  DigestOperation<32> sha256(std::span<const std::uint8_t> input) const {
    return DigestOperation<32>(route_, resume_, DigestAlgorithm::Sha256, input);
  }
  DigestOperation<48> sha384(std::span<const std::uint8_t> input) const {
    return DigestOperation<48>(route_, resume_, DigestAlgorithm::Sha384, input);
  }
  DigestOperation<64> sha512(std::span<const std::uint8_t> input) const {
    return DigestOperation<64>(route_, resume_, DigestAlgorithm::Sha512, input);
  }

 private:
  DigestRoute route_;
  BindingRuntime::Resume resume_;
};

}  // namespace cf
