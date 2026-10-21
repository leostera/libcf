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
  // Digests borrow their input; the request body is read without a copy.
  const auto input = bytes_of(request.body);
  SubtleCrypto crypto(context.bindings);
  if (path == "/sha256") co_return reply(co_await crypto.sha256(input));
  if (path == "/sha384") co_return reply(co_await crypto.sha384(input));
  if (path == "/sha512") co_return reply(co_await crypto.sha512(input));
  if (path == "/oversized") {
    const Bytes oversized(kMaxDigestInput + 1);
    co_return reply(co_await crypto.sha256(oversized));
  }
  co_return Response::text("not found", 404);
}
}  // namespace cf
