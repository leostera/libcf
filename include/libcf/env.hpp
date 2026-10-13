#pragma once

#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

namespace libcf {

// An Env is tied to one invocation. The lookup function must not outlive that
// invocation; unlike raw JS values, returned strings are owned by C++.
class Env {
 public:
  using Lookup = std::function<std::optional<std::string>(std::string_view)>;

  explicit Env(Lookup lookup) : lookup_(std::move(lookup)) {}

  [[nodiscard]] std::optional<std::string> var(std::string_view name) const {
    if (name.empty()) return std::nullopt;
    return lookup_(name);
  }

 private:
  Lookup lookup_;
};

}  // namespace libcf
