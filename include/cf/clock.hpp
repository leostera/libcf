#pragma once
#include <chrono>
#include <cmath>
#include <cstdint>
#include <functional>
#include <stdexcept>
#include <utility>
#include "cf/result.hpp"

namespace cf {
// Wall time is not monotonic. Workers freezes Date.now() between I/O events.
class WallClock {
 public:
  using Duration = std::chrono::duration<std::int64_t, std::milli>;
  using TimePoint = std::chrono::sys_time<Duration>;
  using Read = std::function<double()>;
  explicit WallClock(Read read) : read_(std::move(read)) {
    if (!read_) throw std::invalid_argument("clock provider required");
  }
  [[nodiscard]] Result<TimePoint> now() const {
    const double value = read_();
    // Date's +/-100-million-day range is integral and exactly representable
    // in an f64 import; check before converting to the signed C++ duration.
    if (!std::isfinite(value) || std::trunc(value) != value ||
        value < -8640000000000000.0 || value > 8640000000000000.0)
      return Result<TimePoint>::failure({ErrorCode::HostFailure, "invalid wall-clock sample"});
    return Result<TimePoint>::success(TimePoint{Duration{static_cast<std::int64_t>(value)}});
  }
 private:
  Read read_;
};
}  // namespace cf
