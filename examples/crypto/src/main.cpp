#include "cf/subtle_crypto.hpp"
#include "cf/worker.hpp"

namespace cf {
namespace {
template<class BytesLike>
std::string hex(const BytesLike& bytes) {
  constexpr char digits[] = "0123456789abcdef";
  std::string output;
  output.reserve(bytes.size() * 2);
  for (auto byte : bytes) {
    output.push_back(digits[byte >> 4]);
    output.push_back(digits[byte & 15]);
  }
  return output;
}
template<class Digest>
Response reply(const Result<Digest>& result) {
  return result ? Response::text(hex(result.value())) : Response::text("digest failed", 502);
}
}
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (path == "/uuid") co_return Response::text(context.crypto.random_uuid());
  if (path == "/random") co_return Response::text(hex(context.crypto.random_bytes(32)));
  if (request.method != "POST") co_return Response::text("not found", 404);
  Bytes input(request.body.begin(), request.body.end());
  SubtleCrypto crypto(context.bindings);
  if (path == "/sha256") co_return reply(co_await crypto.sha256(std::move(input)));
  if (path == "/sha384") co_return reply(co_await crypto.sha384(std::move(input)));
  if (path == "/sha512") co_return reply(co_await crypto.sha512(std::move(input)));
  if (path == "/oversized") {
    input.resize(1048577);
    co_return reply(co_await crypto.sha256(std::move(input)));
  }
  co_return Response::text("not found", 404);
}
}  // namespace cf
