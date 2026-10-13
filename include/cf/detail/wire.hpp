#pragma once

#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace cf::detail {

// Host results use length-prefixed fields; never trust lengths returned by JS
// or a future runtime implementation before constructing owned C++ objects.
class WireReader {
 public:
  explicit WireReader(std::span<const std::uint8_t> bytes) : bytes_(bytes) {}

  bool u32(std::uint32_t& output) {
    if (bytes_.size() - offset_ < 4) return false;
    output = static_cast<std::uint32_t>(bytes_[offset_]) |
             (static_cast<std::uint32_t>(bytes_[offset_ + 1]) << 8) |
             (static_cast<std::uint32_t>(bytes_[offset_ + 2]) << 16) |
             (static_cast<std::uint32_t>(bytes_[offset_ + 3]) << 24);
    offset_ += 4;
    return true;
  }

  bool string(std::string& output) {
    std::uint32_t size = 0;
    if (!u32(size) || size > bytes_.size() - offset_) return false;
    if (size == 0) output.clear();
    else output.assign(reinterpret_cast<const char*>(bytes_.data() + offset_), size);
    offset_ += size;
    return true;
  }

  bool bytes(std::vector<std::uint8_t>& output) {
    std::uint32_t size = 0;
    if (!u32(size) || size > bytes_.size() - offset_) return false;
    if (size == 0) output.clear();
    else output.assign(bytes_.begin() + offset_, bytes_.begin() + offset_ + size);
    offset_ += size;
    return true;
  }

  [[nodiscard]] bool done() const noexcept { return offset_ == bytes_.size(); }

 private:
  std::span<const std::uint8_t> bytes_;
  std::size_t offset_ = 0;
};

}  // namespace cf::detail
