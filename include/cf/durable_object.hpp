#pragma once

#include <string>
#include <utility>

#include "cf/service.hpp"

namespace cf {

class DurableObjectNamespace;

class DurableObjectStub {
 public:
  [[nodiscard]] AsyncResult<Response> fetch(Request request) const {
    if (object_name_.empty())
      return ServiceBinding::invalid("Durable Object name must not be empty");
    return service_.fetch(std::move(request), Operation::DurableFetch, object_name_);
  }

 private:
  friend class DurableObjectNamespace;
  DurableObjectStub(BindingRuntime runtime, std::string binding, std::string object_name)
      : service_(std::move(runtime), std::move(binding)), object_name_(std::move(object_name)) {}
  ServiceBinding service_;
  std::string object_name_;
};

class DurableObjectNamespace {
 public:
  DurableObjectNamespace(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}
  [[nodiscard]] DurableObjectStub getByName(std::string name) const {
    return DurableObjectStub(runtime_, binding_, std::move(name));
  }

 private:
  BindingRuntime runtime_;
  std::string binding_;
};

}  // namespace cf
