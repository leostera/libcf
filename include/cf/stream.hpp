#pragma once

#include <functional>
#include <optional>
#include <string>
#include <utility>

namespace cf {

// The host invokes next() only when its ReadableStream requests data. A nullopt
// closes the stream; an empty string is a valid zero-length chunk. The source
// belongs to one response and must not be used after cancellation.
class StreamSource {
 public:
  using Next = std::function<std::optional<std::string>()>;

  explicit StreamSource(Next next) : next_(std::move(next)) {}
  [[nodiscard]] std::optional<std::string> next() { return next_(); }

 private:
  Next next_;
};

}  // namespace cf
