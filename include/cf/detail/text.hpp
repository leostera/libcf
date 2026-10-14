#pragma once
#include <cstdint>
#include <string_view>

namespace cf::detail {
// Validate bounded Unicode scalar UTF-8 without normalizing BOM or NUL.
inline bool bounded_utf8(std::string_view text, std::size_t minimum, std::size_t maximum) {
  if (text.size() < minimum || text.size() > maximum) return false;
  for (std::size_t i = 0; i < text.size();) {
    auto lead = static_cast<std::uint8_t>(text[i++]);
    if (lead < 0x80) continue;
    std::uint32_t value = 0, floor = 0;
    unsigned tail = 0;
    if (lead >= 0xc2 && lead <= 0xdf) { value = lead & 0x1f; floor = 0x80; tail = 1; }
    else if (lead >= 0xe0 && lead <= 0xef) { value = lead & 0x0f; floor = 0x800; tail = 2; }
    else if (lead >= 0xf0 && lead <= 0xf4) { value = lead & 0x07; floor = 0x10000; tail = 3; }
    else return false;
    if (text.size() - i < tail) return false;
    for (unsigned n = 0; n < tail; ++n) {
      auto next = static_cast<std::uint8_t>(text[i++]);
      if ((next & 0xc0) != 0x80) return false;
      value = (value << 6) | (next & 0x3f);
    }
    if (value < floor || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return false;
  }
  return true;
}
}  // namespace cf::detail
