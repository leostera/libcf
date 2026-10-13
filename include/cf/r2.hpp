#pragma once

#include <charconv>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {

struct R2Object {
  std::string key;
  std::uint64_t size;
  std::string etag;
  std::string http_etag;
  std::string content_type;
};
struct R2ObjectBody {
  R2Object object;
  Bytes body;
};
struct R2Range {
  std::uint64_t offset;
  std::optional<std::uint64_t> length;
};
struct R2ListPage {
  std::vector<R2Object> objects;
  std::optional<std::string> next_cursor;
};

namespace detail {
inline bool read_r2_object(WireReader& reader, R2Object& object) {
  std::string size;
  if (!reader.string(object.key) || !reader.string(size) || !reader.string(object.etag) ||
      !reader.string(object.http_etag) || !reader.string(object.content_type)) return false;
  const auto [end, error] = std::from_chars(size.data(), size.data() + size.size(), object.size);
  return error == std::errc{} && end == size.data() + size.size();
}
inline Result<std::optional<R2Object>> decode_r2_head(OperationReply reply) {
  if (reply.kind == ReplyKind::Missing) return Result<std::optional<R2Object>>::success(std::nullopt);
  WireReader reader(reply.bytes);
  R2Object object;
  if (!read_r2_object(reader, object) || !reader.done())
    return Result<std::optional<R2Object>>::failure({ErrorCode::InvalidInput, "malformed R2 metadata"});
  return Result<std::optional<R2Object>>::success(std::move(object));
}
}  // namespace detail

class R2Bucket {
 public:
  R2Bucket(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  [[nodiscard]] AsyncResult<std::optional<R2ObjectBody>> get(
      std::string key, std::optional<R2Range> range = std::nullopt) const {
    std::string options;
    if (range) options = std::to_string(range->offset) + "\n" +
                         (range->length ? std::to_string(*range->length) : std::string{});
    return runtime_.call<std::optional<R2ObjectBody>>(
        {Operation::R2Get, binding_, std::move(key), {}, std::move(options)},
        [](OperationReply reply) -> Result<std::optional<R2ObjectBody>> {
          if (reply.kind == ReplyKind::Missing)
            return Result<std::optional<R2ObjectBody>>::success(std::nullopt);
          detail::WireReader reader(reply.bytes);
          R2ObjectBody object;
          if (!detail::read_r2_object(reader, object.object) || !reader.bytes(object.body) || !reader.done())
            return Result<std::optional<R2ObjectBody>>::failure({ErrorCode::InvalidInput, "malformed R2 body"});
          return Result<std::optional<R2ObjectBody>>::success(std::move(object));
        });
  }
  [[nodiscard]] AsyncResult<std::optional<R2Object>> head(std::string key) const {
    return runtime_.call<std::optional<R2Object>>(
        {Operation::R2Head, binding_, std::move(key), {}, {}}, detail::decode_r2_head);
  }
  [[nodiscard]] AsyncResult<R2Object> put(std::string key, Bytes bytes,
                                        std::string content_type = "application/octet-stream") const {
    return runtime_.call<R2Object>(
        {Operation::R2Put, binding_, std::move(key), std::move(bytes), std::move(content_type)},
        [](OperationReply reply) -> Result<R2Object> {
          auto result = detail::decode_r2_head(std::move(reply));
          if (!result) return Result<R2Object>::failure(result.error());
          if (!result.value()) return Result<R2Object>::failure({ErrorCode::HostFailure, "R2 put returned no object"});
          return Result<R2Object>::success(std::move(*result.value()));
        });
  }
  [[nodiscard]] AsyncResult<Unit> erase(std::string key) const {
    return runtime_.call<Unit>({Operation::R2Delete, binding_, std::move(key), {}, {}},
                              [](OperationReply) { return Result<Unit>::success({}); });
  }
  [[nodiscard]] AsyncResult<R2ListPage> list(std::string prefix = {}, std::string cursor = {},
                                           std::uint32_t limit = 1000) const {
    const auto count = std::to_string(limit);
    return runtime_.call<R2ListPage>(
        {Operation::R2List, binding_, std::move(prefix), Bytes(count.begin(), count.end()), std::move(cursor)},
        [limit](OperationReply reply) -> Result<R2ListPage> {
          const auto invalid = [] { return Result<R2ListPage>::failure({ErrorCode::InvalidInput, "malformed R2 list"}); };
          if (reply.kind != ReplyKind::Value) return invalid();
          detail::WireReader reader(reply.bytes);
          std::uint32_t count = 0, truncated = 0;
          std::string cursor;
          if (!reader.u32(count) || count > limit || count > 1000 ||
              !reader.u32(truncated) || truncated > 1 || !reader.string(cursor) ||
              count > reader.remaining() / 20) return invalid();
          R2ListPage page;
          for (std::uint32_t i = 0; i < count; ++i) {
            R2Object object;
            if (!detail::read_r2_object(reader, object)) return invalid();
            page.objects.push_back(std::move(object));
          }
          if (!reader.done() || (truncated && cursor.empty())) return invalid();
          if (truncated) page.next_cursor = std::move(cursor);
          return Result<R2ListPage>::success(std::move(page));
        });
  }
 private:
  BindingRuntime runtime_;
  std::string binding_;
};

}  // namespace cf
