#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <string>

#include "libcf/http.hpp"

namespace libcf::detail {

// Each header is [name length:u32 LE][value length:u32 LE][name bytes][value
// bytes]. The adapter limits the entire block to 64 KiB before crossing Wasm.
// Parsing returns a trusted Headers object only if the block is fully consumed.
inline std::optional<Headers> parse_headers(std::span<const std::uint8_t> wire) {
  Headers result;
  std::size_t offset = 0;
  const auto read_u32 = [&](std::uint32_t& output) -> bool {
    if (wire.size() - offset < 4) return false;
    output = static_cast<std::uint32_t>(wire[offset]) |
             (static_cast<std::uint32_t>(wire[offset + 1]) << 8) |
             (static_cast<std::uint32_t>(wire[offset + 2]) << 16) |
             (static_cast<std::uint32_t>(wire[offset + 3]) << 24);
    offset += 4;
    return true;
  };
  while (offset < wire.size()) {
    std::uint32_t name_length = 0;
    std::uint32_t value_length = 0;
    if (!read_u32(name_length) || !read_u32(value_length)) return std::nullopt;
    if (name_length == 0 || name_length > wire.size() - offset) return std::nullopt;
    std::string name(reinterpret_cast<const char*>(wire.data() + offset), name_length);
    offset += name_length;
    if (value_length > wire.size() - offset) return std::nullopt;
    std::string value(reinterpret_cast<const char*>(wire.data() + offset), value_length);
    offset += value_length;
    result.append(std::move(name), std::move(value));
  }
  return result;
}

}  // namespace libcf::detail
