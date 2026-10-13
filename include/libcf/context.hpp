#pragma once

#include <functional>
#include <string>
#include <utility>

namespace libcf {

// A background task is a description of one host operation, not a detached
// C++ thread. The JS adapter attaches its Promise to ExecutionContext.waitUntil.
struct BackgroundWork {
  enum class Kind { KvPut, Fetch };
  Kind kind;
  std::string target;
  std::string key;
  std::string value;

  static BackgroundWork kv_put(std::string binding, std::string key, std::string value) {
    return {Kind::KvPut, std::move(binding), std::move(key), std::move(value)};
  }
  static BackgroundWork fetch(std::string url) {
    return {Kind::Fetch, std::move(url), {}, {}};
  }
};

class Context {
 public:
  using Schedule = std::function<void(const BackgroundWork&)>;

  explicit Context(Schedule schedule) : schedule_(std::move(schedule)) {}

  void wait_until(const BackgroundWork& work) const { schedule_(work); }

 private:
  Schedule schedule_;
};

}  // namespace libcf
