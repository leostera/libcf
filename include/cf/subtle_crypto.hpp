#pragma once

#include <algorithm>
#include <array>
#include "cf/operation.hpp"

namespace cf {
class SubtleCrypto {
 public:
  explicit SubtleCrypto(BindingRuntime runtime) : runtime_(std::move(runtime)) {}
  [[nodiscard]] AsyncResult<std::array<std::uint8_t, 32>> sha256(Bytes input) const {
    return digest<32>(std::move(input), "SHA-256");
  }
  [[nodiscard]] AsyncResult<std::array<std::uint8_t, 48>> sha384(Bytes input) const {
    return digest<48>(std::move(input), "SHA-384");
  }
  [[nodiscard]] AsyncResult<std::array<std::uint8_t, 64>> sha512(Bytes input) const {
    return digest<64>(std::move(input), "SHA-512");
  }
 private:
  template<std::size_t Size>
  AsyncResult<std::array<std::uint8_t, Size>> digest(Bytes input, std::string algorithm) const {
    using Digest = std::array<std::uint8_t, Size>;
    if (input.size() > 1024 * 1024)
      return AsyncResult<Digest>([](auto complete) {
        complete(Result<Digest>::failure({ErrorCode::InvalidInput, "digest input exceeds 1 MiB"}));
      }, [](std::coroutine_handle<>) {});
    return runtime_.call<Digest>({Operation::CryptoDigest, {}, std::move(algorithm), std::move(input), {}},
        [](OperationReply reply) {
          if (reply.kind != ReplyKind::Value || reply.bytes.size() != Size)
            return Result<Digest>::failure({ErrorCode::HostFailure, "invalid digest reply"});
          Digest value;
          std::copy(reply.bytes.begin(), reply.bytes.end(), value.begin());
          return Result<Digest>::success(value);
        });
  }
  BindingRuntime runtime_;
};
}  // namespace cf
