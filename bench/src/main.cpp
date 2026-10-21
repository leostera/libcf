#include "cf/subtle_crypto.hpp"
#include "cf/worker.hpp"
#include "kernels.hpp"

namespace cf {
namespace {
Response binary(std::string body) {
  Response response;
  response.headers.append("content-type", "application/octet-stream");
  response.body = std::move(body);
  return response;
}

std::uint8_t* bytes(std::string& text) { return reinterpret_cast<std::uint8_t*>(text.data()); }
}  // namespace

Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (path == "/hello") co_return Response::text("ok");
  if (path == "/echo") co_return Response::text(std::move(request.body));
  if (path == "/image") {
    const auto params = bench::parse_query<2>(request.url, {"w", "h"});
    if (!params || !bench::valid_image((*params)[0], (*params)[1], request.body.size()))
      co_return Response::text("invalid image request", 400);
    std::string output(request.body.size(), '\0');
    bench::image(bytes(request.body), (*params)[0], (*params)[1], bytes(output));
    co_return binary(std::move(output));
  }
  if (path == "/search") {
    const auto params = bench::parse_query<4>(request.url, {"n", "d", "q", "k"});
    if (!params) co_return Response::text("invalid search request", 400);
    const auto [n, d, q, k] = *params;
    if (!bench::valid_search(n, d, q, k, request.body.size()))
      co_return Response::text("invalid search request", 400);
    std::string output(static_cast<std::size_t>(q) * k * 8, '\0');
    bench::search(bytes(request.body), n, d, q, k, bytes(output));
    co_return binary(std::move(output));
  }
  if (path != "/digest/1" && path != "/digest/16") co_return Response::text("not found", 404);
  const int iterations = path == "/digest/16" ? 16 : 1;
  const auto input = bytes_of(request.body);  // borrowed, like Rust's &[u8]
  SubtleCrypto crypto(context.bindings);
  std::array<std::uint8_t, 32> digest{};
  for (int index = 0; index < iterations; ++index) {
    auto result = co_await crypto.sha256(input);
    if (!result) co_return Response::text("digest failed", 502);
    digest = result.value();
  }
  constexpr char hex[] = "0123456789abcdef";
  std::string output;
  output.reserve(64);
  for (auto byte : digest) {
    output.push_back(hex[byte >> 4]);
    output.push_back(hex[byte & 15]);
  }
  co_return Response::text(std::move(output));
}
}  // namespace cf
