#pragma once

#include <functional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cf/http.hpp"

namespace cf {

struct RouteParam {
  std::string name;
  std::string value;
};

class RouteParams {
 public:
  [[nodiscard]] std::string_view get(std::string_view name) const noexcept {
    for (const auto& param : values_) {
      if (param.name == name) return param.value;
    }
    return {};
  }

 private:
  friend class Router;
  std::vector<RouteParam> values_;
};

class Router {
 public:
  using Handler = std::function<Response(const Request&, const RouteParams&)>;

  // Only absolute patterns and named single-segment parameters are accepted.
  // Duplicate method/pattern pairs are rejected rather than shadowed.
  bool route(std::string method, std::string pattern, Handler handler) {
    if (method.empty() || !handler || pattern.empty() || pattern.front() != '/') return false;
    for (const auto& existing : routes_) {
      if (existing.method == method && existing.pattern == pattern) return false;
    }
    for (const auto segment : segments(pattern)) {
      if (segment == ":") return false;
    }
    routes_.push_back({std::move(method), std::move(pattern), std::move(handler)});
    return true;
  }

  [[nodiscard]] Response dispatch(const Request& request) const {
    bool path_exists = false;
    // Literal routes take priority even when registered after a parameterized
    // route, preventing a variable from masking a static endpoint.
    for (int phase = 0; phase != 2; ++phase) {
      for (const auto& route : routes_) {
        const bool parameterized = route.pattern.find(':') != std::string::npos;
        if (parameterized != (phase == 1)) continue;
        RouteParams params;
        if (!match(route.pattern, request.path(), params)) continue;
        path_exists = true;
        if (route.method == request.method) return route.handler(request, params);
      }
    }
    return Response::text(path_exists ? "method not allowed" : "not found",
                          path_exists ? 405 : 404);
  }

 private:
  struct Route {
    std::string method;
    std::string pattern;
    Handler handler;
  };

  static std::vector<std::string_view> segments(std::string_view path) {
    std::vector<std::string_view> result;
    if (path == "/") return result;
    path.remove_prefix(1);
    while (true) {
      const auto slash = path.find('/');
      result.push_back(path.substr(0, slash));
      if (slash == std::string_view::npos) return result;
      path.remove_prefix(slash + 1);
    }
  }

  static bool match(std::string_view pattern, std::string_view path, RouteParams& params) {
    const auto pattern_parts = segments(pattern);
    const auto path_parts = segments(path);
    if (pattern_parts.size() != path_parts.size()) return false;
    for (std::size_t i = 0; i < pattern_parts.size(); ++i) {
      if (!pattern_parts[i].empty() && pattern_parts[i].front() == ':') {
        if (path_parts[i].empty()) return false;
        params.values_.push_back(
            {std::string(pattern_parts[i].substr(1)), std::string(path_parts[i])});
      } else if (pattern_parts[i] != path_parts[i]) {
        return false;
      }
    }
    return true;
  }

  std::vector<Route> routes_;
};

}  // namespace cf
