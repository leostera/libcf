#include <cassert>
#include <limits>
#include "cf/clock.hpp"

int main() {
  double value = 0;
  int calls = 0;
  cf::WallClock clock([&] { ++calls; return value; });
  for (const auto expected : {std::int64_t{0}, std::int64_t{-1}, std::int64_t{1},
                              std::int64_t{8640000000000000}, std::int64_t{-8640000000000000}}) {
    value = static_cast<double>(expected);
    auto result = clock.now();
    assert(result && result.value().time_since_epoch().count() == expected);
  }
  // A backwards step is valid wall time, not a monotonic-clock failure.
  value = 100;
  auto before = clock.now();
  value = 50;
  assert(clock.now().value() < before.value());
  for (const double invalid : {0.5, -0.5, 8640000000000001.0, -8640000000000001.0,
      std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(),
      std::numeric_limits<double>::quiet_NaN()}) {
    value = invalid;
    auto result = clock.now();
    assert(!result && result.error().code == cf::ErrorCode::HostFailure);
  }
  assert(calls == 14);
  bool rejected = false;
  try { cf::WallClock missing(cf::WallClock::Read{}); }
  catch (const std::invalid_argument&) { rejected = true; }
  assert(rejected);
}
