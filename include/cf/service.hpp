#pragma once

#include <charconv>
#include <string>
#include <utility>

#include "cf/detail/header_wire.hpp"
#include "cf/detail/wire.hpp"
#include "cf/http.hpp"
#include "cf/operation.hpp"

namespace cf {

class ServiceBinding {
 public:
  ServiceBinding(BindingRuntime runtime, std::string name)
      : runtime_(std::move(runtime)), name_(std::move(name)) {}

  [[nodiscard]] AsyncResult<Response> fetch(Request request) const {
    return fetch(std::move(request), Operation::ServiceFetch, {});
  }

 private:
  friend class DurableObjectStub;
  AsyncResult<Response> fetch(Request request, Operation operation, std::string options) const {
    if (request.body.size() > 1024 * 1024 || request.method.empty() || request.method.size() > 32)
      return invalid("invalid binding request size");
    Bytes headers;
    for (const auto& header : request.headers.fields()) {
      if (header.name.size() > 65536 || header.value.size() > 65536 ||
          headers.size() + header.name.size() + header.value.size() + 8 > 65536)
        return invalid("binding request headers too large");
      u32(headers, static_cast<std::uint32_t>(header.name.size()));
      u32(headers, static_cast<std::uint32_t>(header.value.size()));
      headers.insert(headers.end(), header.name.begin(), header.name.end());
      headers.insert(headers.end(), header.value.begin(), header.value.end());
    }
    Bytes wire;
    field(wire, request.method);
    u32(wire, static_cast<std::uint32_t>(headers.size()));
    wire.insert(wire.end(), headers.begin(), headers.end());
    field(wire, request.body);
    return runtime_.call<Response>(
        {operation, name_, std::move(request.url), std::move(wire), std::move(options)},
        [](OperationReply reply) -> Result<Response> {
          const auto invalid = [] { return Result<Response>::failure({ErrorCode::InvalidInput, "invalid binding response"}); };
          if (reply.kind != ReplyKind::Value) return invalid();
          detail::WireReader reader(reply.bytes);
          Response response;
          std::string status, body;
          Bytes headers;
          if (!reader.string(status) || !reader.bytes(headers) || !reader.string(body) || !reader.done()) return invalid();
          const auto [end, error] = std::from_chars(status.data(), status.data() + status.size(), response.status);
          auto parsed = detail::parse_headers(headers);
          if (error != std::errc{} || end != status.data() + status.size() ||
              response.status < 200 || response.status > 599 || !parsed) return invalid();
          response.headers = std::move(*parsed);
          response.body = std::move(body);
          return Result<Response>::success(std::move(response));
        });
  }

  static AsyncResult<Response> invalid(std::string message) {
    return AsyncResult<Response>([message = std::move(message)](auto complete) {
      complete(Result<Response>::failure({ErrorCode::InvalidInput, message}));
    }, [](std::coroutine_handle<>) {});
  }
  static void u32(Bytes& bytes, std::uint32_t value) {
    for (int shift = 0; shift != 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
  static void field(Bytes& bytes, std::string_view value) {
    u32(bytes, static_cast<std::uint32_t>(value.size()));
    bytes.insert(bytes.end(), value.begin(), value.end());
  }
  BindingRuntime runtime_;
  std::string name_;
};

}  // namespace cf
