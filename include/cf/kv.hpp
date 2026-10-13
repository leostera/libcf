#pragma once

#include <charconv>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "cf/detail/wire.hpp"
#include "cf/operation.hpp"

namespace cf {

struct KvPutOptions {
  std::optional<std::uint32_t> expiration_ttl;
  std::optional<std::uint64_t> expiration;
  // Raw JSON is preserved; the JS boundary parses it before calling KV.put.
  std::optional<std::string> metadata_json;
};

struct KvEntry {
  Bytes value;
  std::optional<std::string> metadata_json;
};

struct KvKey {
  std::string name;
  std::optional<std::uint64_t> expiration;
  std::optional<std::string> metadata_json;
};

struct KvListPage {
  std::vector<KvKey> keys;
  std::optional<std::string> next_cursor;  // nullopt iff list_complete
};

class KvNamespace {
 public:
  KvNamespace(BindingRuntime runtime, std::string binding)
      : runtime_(std::move(runtime)), binding_(std::move(binding)) {}

  [[nodiscard]] AsyncResult<std::optional<std::string>> get_text(
      std::string key, std::optional<std::uint32_t> cache_ttl = std::nullopt) const {
    return runtime_.call<std::optional<std::string>>(
        {Operation::KvGetText, binding_, std::move(key), {}, ttl_text(cache_ttl)},
        [](OperationReply reply) -> Result<std::optional<std::string>> {
          if (reply.kind == ReplyKind::Missing)
            return Result<std::optional<std::string>>::success(std::nullopt);
          return Result<std::optional<std::string>>::success(std::string(reply.bytes.begin(), reply.bytes.end()));
        });
  }

  [[nodiscard]] AsyncResult<std::optional<Bytes>> get_bytes(std::string key) const {
    return runtime_.call<std::optional<Bytes>>(
        {Operation::KvGetBytes, binding_, std::move(key), {}, {}},
        [](OperationReply reply) -> Result<std::optional<Bytes>> {
          if (reply.kind == ReplyKind::Missing)
            return Result<std::optional<Bytes>>::success(std::nullopt);
          return Result<std::optional<Bytes>>::success(std::move(reply.bytes));
        });
  }

  [[nodiscard]] AsyncResult<std::optional<KvEntry>> get_with_metadata(std::string key) const {
    return runtime_.call<std::optional<KvEntry>>(
        {Operation::KvGetMetadata, binding_, std::move(key), {}, {}},
        [](OperationReply reply) -> Result<std::optional<KvEntry>> {
          if (reply.kind == ReplyKind::Missing)
            return Result<std::optional<KvEntry>>::success(std::nullopt);
          detail::WireReader reader(reply.bytes);
          KvEntry entry;
          std::string metadata;
          if (!reader.bytes(entry.value) || !reader.string(metadata) || !reader.done())
            return Result<std::optional<KvEntry>>::failure({ErrorCode::InvalidInput, "malformed KV metadata reply"});
          if (!metadata.empty()) entry.metadata_json = std::move(metadata);
          return Result<std::optional<KvEntry>>::success(std::move(entry));
        });
  }

  [[nodiscard]] AsyncResult<Unit> put(std::string key, Bytes value,
                                      KvPutOptions options = {}) const {
    return runtime_.call<Unit>(
        {Operation::KvPut, binding_, std::move(key), std::move(value), put_options(options)},
        [](OperationReply) { return Result<Unit>::success({}); });
  }

  [[nodiscard]] AsyncResult<Unit> put_text(std::string key, std::string value,
                                           KvPutOptions options = {}) const {
    return put(std::move(key), Bytes(value.begin(), value.end()), std::move(options));
  }

  [[nodiscard]] AsyncResult<Unit> erase(std::string key) const {
    return runtime_.call<Unit>(
        {Operation::KvDelete, binding_, std::move(key), {}, {}},
        [](OperationReply) { return Result<Unit>::success({}); });
  }

  [[nodiscard]] AsyncResult<KvListPage> list(std::string prefix = {},
                                             std::string cursor = {},
                                             std::uint32_t limit = 1000) const {
    return runtime_.call<KvListPage>(
        {Operation::KvList, binding_, std::move(prefix), limit_bytes(limit), std::move(cursor)},
        [](OperationReply reply) -> Result<KvListPage> {
          detail::WireReader reader(reply.bytes);
          std::uint32_t count = 0;
          std::uint32_t complete = 0;
          std::string cursor;
          if (!reader.u32(count) || !reader.u32(complete) || complete > 1 ||
              !reader.string(cursor) || count > reply.bytes.size() / 12)
            return Result<KvListPage>::failure({ErrorCode::InvalidInput, "malformed KV list reply"});
          KvListPage page;
          page.keys.reserve(count);
          for (std::uint32_t i = 0; i < count; ++i) {
            KvKey key;
            std::string expiration;
            std::string metadata;
            if (!reader.string(key.name) || !reader.string(expiration) || !reader.string(metadata))
              return Result<KvListPage>::failure({ErrorCode::InvalidInput, "malformed KV key"});
            if (!expiration.empty()) {
              std::uint64_t value = 0;
              const auto [end, error] = std::from_chars(expiration.data(), expiration.data() + expiration.size(), value);
              if (error != std::errc{} || end != expiration.data() + expiration.size())
                return Result<KvListPage>::failure({ErrorCode::InvalidInput, "invalid KV expiration"});
              key.expiration = value;
            }
            if (!metadata.empty()) key.metadata_json = std::move(metadata);
            page.keys.push_back(std::move(key));
          }
          if (!reader.done()) return Result<KvListPage>::failure({ErrorCode::InvalidInput, "trailing KV list data"});
          if (!complete) page.next_cursor = std::move(cursor);
          return Result<KvListPage>::success(std::move(page));
        });
  }

 private:
  static std::string ttl_text(std::optional<std::uint32_t> ttl) {
    return ttl ? std::to_string(*ttl) : std::string{};
  }

  static Bytes limit_bytes(std::uint32_t limit) {
    const auto text = std::to_string(limit);
    return Bytes(text.begin(), text.end());
  }

  static std::string put_options(const KvPutOptions& options) {
    // Only the first two lines are protocol delimiters. The remaining bytes
    // are one independent JSON value, never interpolated into an options object.
    return ttl_text(options.expiration_ttl) + "\n" +
           (options.expiration ? std::to_string(*options.expiration) : std::string{}) + "\n" +
           options.metadata_json.value_or("");
  }

  BindingRuntime runtime_;
  std::string binding_;
};

}  // namespace cf
