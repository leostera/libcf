#pragma once

#include <array>
#include <cstdint>
#include <functional>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace cf {

// Entropy always comes from the platform's cryptographic RNG, never from the
// C++ runtime's predictable PRNG. Fill must either fill all bytes or fail.
class Crypto {
 public:
  using Fill = std::function<void(std::span<std::uint8_t>)>;

  explicit Crypto(Fill fill) : fill_(std::move(fill)) {}

  [[nodiscard]] std::vector<std::uint8_t> random_bytes(std::size_t length) const {
    if (length > 65536) throw std::length_error("Web Crypto limits one call to 65536 bytes");
    std::vector<std::uint8_t> bytes(length);
    if (!bytes.empty()) fill_(bytes);
    return bytes;
  }

  [[nodiscard]] std::string random_uuid() const {
    std::array<std::uint8_t, 16> bytes{};
    fill_(bytes);
    bytes[6] = static_cast<std::uint8_t>((bytes[6] & 0x0f) | 0x40);
    bytes[8] = static_cast<std::uint8_t>((bytes[8] & 0x3f) | 0x80);
    constexpr char hex[] = "0123456789abcdef";
    std::string result(36, '-');
    std::size_t index = 0;
    for (auto byte : bytes) {
      if (index == 8 || index == 13 || index == 18 || index == 23) ++index;
      result[index++] = hex[byte >> 4];
      result[index++] = hex[byte & 0x0f];
    }
    return result;
  }

 private:
  Fill fill_;
};

}  // namespace cf
