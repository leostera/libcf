#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace libcf {

struct Header {
  std::string name;
  std::string value;
};

class Headers {
 public:
  void append(std::string name, std::string value) {
    fields_.push_back({std::move(name), std::move(value)});
  }

  // Header names are ASCII and case insensitive; duplicate fields are allowed.
  [[nodiscard]] std::optional<std::string_view> get(std::string_view name) const {
    for (const auto& field : fields_) {
      if (equals_ignore_ascii_case(field.name, name)) return field.value;
    }
    return std::nullopt;
  }

  [[nodiscard]] const std::vector<Header>& fields() const noexcept { return fields_; }

 private:
  static bool equals_ignore_ascii_case(std::string_view left, std::string_view right) {
    if (left.size() != right.size()) return false;
    for (std::size_t i = 0; i < left.size(); ++i) {
      auto lower = [](unsigned char c) {
        return c >= 'A' && c <= 'Z' ? static_cast<unsigned char>(c + ('a' - 'A')) : c;
      };
      if (lower(static_cast<unsigned char>(left[i])) !=
          lower(static_cast<unsigned char>(right[i]))) return false;
    }
    return true;
  }

  std::vector<Header> fields_;
};

// Method and URL are received from the host as bytes and copied into this
// request. The JS adapter must bound body size before buffering it.
struct Request {
  std::string method;
  std::string url;
  Headers headers;
  std::string body;

  [[nodiscard]] std::string_view path() const noexcept {
    std::string_view address = url;
    auto scheme = address.find("://");
    if (scheme != std::string_view::npos) {
      const auto slash = address.find('/', scheme + 3);
      if (slash == std::string_view::npos) return "/";
      address.remove_prefix(slash);
    }
    if (address.empty() || address.front() != '/') return "/";
    const auto end = address.find_first_of("?#");
    return address.substr(0, end);
  }
};

// A complete body is appropriate for bounded responses; streaming responses
// use the host adapter's pull protocol and never pass through this value.
struct Response {
  int status = 200;
  Headers headers;
  std::string body;

  static Response text(std::string content, int code = 200) {
    Response response;
    response.status = code;
    response.headers.append("content-type", "text/plain; charset=utf-8");
    response.body = std::move(content);
    return response;
  }
};

}  // namespace libcf
