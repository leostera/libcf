#include "cf/subtle_crypto.hpp"
#include "cf/worker.hpp"

namespace cf {
Task handle(Request request, WorkerContext context) {
  const auto path = request.path();
  if (path == "/hello") co_return Response::text("ok");
  if (path == "/echo") co_return Response::text(std::move(request.body));
  if (path != "/digest/1" && path != "/digest/16") co_return Response::text("not found", 404);
  const int iterations = path == "/digest/16" ? 16 : 1;
  const Bytes input(request.body.begin(), request.body.end());
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
