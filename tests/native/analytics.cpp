#include <cassert>
#include <limits>
#include "cf/analytics.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  AnalyticsDataPoint point{{std::string("x"), Bytes{0, 255}, nullptr}, {1.5, -0.0}, std::string("i")};
  auto encoded = detail::encode_analytics(point);
  assert(encoded && encoded.value().size() == 64);
  std::string hex;
  for (auto byte : encoded.value()) {
    hex.push_back("0123456789abcdef"[byte >> 4]);
    hex.push_back("0123456789abcdef"[byte & 15]);
  }
  assert(hex == "02000000000000000000f83f000000000000008003000000010000000100000078020000000200000000ff000000000000000001000000010000000100000069");
  auto invalid = point;
  invalid.doubles.push_back(std::numeric_limits<double>::infinity());
  assert(!detail::encode_analytics(invalid));
  invalid = point;
  invalid.blobs.resize(21);
  assert(!detail::encode_analytics(invalid));
  invalid = point;
  invalid.blobs = {std::string(8192, 'x'), Bytes(8193)};
  assert(!detail::encode_analytics(invalid));
  invalid = point;
  invalid.index = std::string(97, 'x');
  assert(!detail::encode_analytics(invalid));
  int calls = 0;
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::AnalyticsWriteDataPoint && call.body == encoded.value());
    done(Result<OperationReply>::success({ReplyKind::Value, {}}));
  }, [](auto) {});
  AnalyticsEngine dataset(runtime, "DATASET");
  auto handler = [&]() -> Task {
    auto accepted = co_await dataset.write(point);
    assert(accepted);
    auto rejected = co_await dataset.write(invalid);
    assert(!rejected);
    co_return Response{};
  };
  auto task = handler().take();
  task.resume();
  assert(task.done() && calls == 1);
  task.destroy();
}
