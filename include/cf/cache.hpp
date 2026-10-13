#pragma once

#include <charconv>
#include <optional>
#include <string>
#include <utility>

#include "cf/detail/header_wire.hpp"
#include "cf/detail/wire.hpp"
#include "cf/http.hpp"
#include "cf/operation.hpp"

namespace cf {

struct CachedResponse {
  int status = 200;
  Headers headers;
  Bytes body;
};

class Cache {
 public:
  // Empty name selects caches.default; other names select caches.open(name).
  Cache(BindingRuntime runtime, std::string name = {})
      : runtime_(std::move(runtime)), name_(std::move(name)) {}

  [[nodiscard]] AsyncResult<std::optional<CachedResponse>> match(std::string url) const {
    return runtime_.call<std::optional<CachedResponse>>(
        {Operation::CacheMatch, name_, std::move(url), {}, {}},
        [](OperationReply reply) -> Result<std::optional<CachedResponse>> {
          if (reply.kind == ReplyKind::Missing)
            return Result<std::optional<CachedResponse>>::success(std::nullopt);
          detail::WireReader reader(reply.bytes);
          CachedResponse response;
          std::string status;
          Bytes headers;
          if (!reader.string(status) || !reader.bytes(headers) ||
              !reader.bytes(response.body) || !reader.done())
            return Result<std::optional<CachedResponse>>::failure({ErrorCode::InvalidInput, "invalid cached response"});
          const auto [end, error] = std::from_chars(status.data(), status.data() + status.size(), response.status);
          auto parsed = detail::parse_headers(headers);
          if (error != std::errc{} || end != status.data() + status.size() ||
              response.status < 200 || response.status > 599 || !parsed)
            return Result<std::optional<CachedResponse>>::failure({ErrorCode::InvalidInput, "invalid cache metadata"});
          response.headers = std::move(*parsed);
          return Result<std::optional<CachedResponse>>::success(std::move(response));
        });
  }

  [[nodiscard]] AsyncResult<Unit> put(std::string url, CachedResponse response) const {
    if (response.status < 200 || response.status > 599 || response.body.size() > 1024 * 1024)
      return invalid_put("invalid cache status or body size");
    Bytes headers;
    for (const auto& field : response.headers.fields()) {
      if (field.name.size() > 65536 || field.value.size() > 65536 ||
          headers.size() + field.name.size() + field.value.size() + 8 > 65536)
        return invalid_put("cache headers exceed bridge limit");
      append_u32(headers, static_cast<std::uint32_t>(field.name.size()));
      append_u32(headers, static_cast<std::uint32_t>(field.value.size()));
      headers.insert(headers.end(), field.name.begin(), field.name.end());
      headers.insert(headers.end(), field.value.begin(), field.value.end());
    }
    // Three length-delimited fields: decimal status, headers wire, body bytes.
    const auto status = std::to_string(response.status);
    Bytes wire;
    append_u32(wire, static_cast<std::uint32_t>(status.size()));
    wire.insert(wire.end(), status.begin(), status.end());
    append_u32(wire, static_cast<std::uint32_t>(headers.size()));
    wire.insert(wire.end(), headers.begin(), headers.end());
    append_u32(wire, static_cast<std::uint32_t>(response.body.size()));
    wire.insert(wire.end(), response.body.begin(), response.body.end());
    return runtime_.call<Unit>({Operation::CachePut, name_, std::move(url), std::move(wire), {}},
                              [](OperationReply) { return Result<Unit>::success({}); });
  }

  [[nodiscard]] AsyncResult<bool> erase(std::string url) const {
    return runtime_.call<bool>({Operation::CacheDelete, name_, std::move(url), {}, {}},
        [](OperationReply reply) -> Result<bool> {
          if (reply.kind != ReplyKind::Value || reply.bytes.size() != 1 || reply.bytes[0] > 1)
            return Result<bool>::failure({ErrorCode::InvalidInput, "invalid cache delete result"});
          return Result<bool>::success(reply.bytes[0] == 1);
        });
  }

 private:
  static AsyncResult<Unit> invalid_put(std::string message) {
    return AsyncResult<Unit>([message = std::move(message)](auto complete) {
      complete(Result<Unit>::failure({ErrorCode::InvalidInput, message}));
    }, [](std::coroutine_handle<>) {});
  }
  static void append_u32(Bytes& bytes, std::uint32_t value) {
    for (int shift = 0; shift != 32; shift += 8)
      bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
  BindingRuntime runtime_;
  std::string name_;
};

}  // namespace cf
