#include <cassert>
#include "cf/browser.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  int calls = 0;
  const Bytes png{137, 80, 78, 71, 13, 10, 26, 10};
  OperationReply reply{ReplyKind::Value, png};
  std::string expected_html = "\xef\xbb\xbf<p>\xc3\xa9\xf0\x9f\x98\x80";
  expected_html.push_back('\0'); expected_html += "</p>";
  std::string expected_options = "128:128:5000";
  BindingRuntime runtime([&](OperationCall call, BindingRuntime::Completion done) {
    ++calls;
    assert(call.method == Operation::BrowserScreenshotHtmlPng && call.binding == "BROWSER" && call.key.empty());
    assert(call.body == Bytes(expected_html.begin(), expected_html.end()) && call.options == expected_options);
    done(Result<OperationReply>::success(reply));
  }, [](auto) {});
  BrowserRun browser(runtime, "BROWSER");
  auto handler = [&]() -> Task {
    BrowserScreenshotRequest request{expected_html};
    auto pending = browser.screenshot_html_png(request);
    request.html = "caller changed"; request.width = 1;
    auto result = co_await pending;
    assert(result && result.value() == png);
    result.value()[0] = 0;
    assert(reply.bytes == png);
    request = BrowserScreenshotRequest{expected_html};
    for (const auto kind : {ReplyKind::Missing, ReplyKind::Value}) {
      reply.kind = kind;
      reply.bytes = kind == ReplyKind::Missing ? png : Bytes{1};
      auto rejected = co_await browser.screenshot_html_png(request);
      assert(!rejected && rejected.error().code == ErrorCode::HostFailure);
    }
    reply.bytes = Bytes(8, 0);
    assert(!(co_await browser.screenshot_html_png(request)));
    reply.bytes = png; reply.bytes.resize(1048577);
    assert(!(co_await browser.screenshot_html_png(request)));
    reply.bytes.resize(1048576);
    assert(co_await browser.screenshot_html_png(request));
    reply.bytes = png;
    const auto baseline = calls;
    for (const auto& html : {std::string{}, std::string(65537, 'x'), std::string("\xff"),
        std::string("\xc0\x80"), std::string("\xed\xa0\x80"), std::string("\xf0\x9f"), std::string("\xf4\x90\x80\x80")}) {
      request.html = html;
      auto rejected = co_await browser.screenshot_html_png(request);
      assert(!rejected && rejected.error().code == ErrorCode::InvalidInput);
    }
    request.html = expected_html;
    for (const auto size : {0u, 513u, 0xffffffffu}) {
      request.width = size;
      assert(!(co_await browser.screenshot_html_png(request)));
      request.width = 128; request.height = size;
      assert(!(co_await browser.screenshot_html_png(request)));
      request.height = 128;
    }
    for (const auto duration : {-1, 0, 60001}) {
      request.timeout = std::chrono::milliseconds(duration);
      auto rejected = co_await browser.screenshot_html_png(request);
      assert(!rejected && rejected.error().code == ErrorCode::InvalidInput);
    }
    assert(calls == baseline);
    expected_html = std::string(65536, 'x'); expected_options = "1:512:60000";
    request = BrowserScreenshotRequest{expected_html, 1, 512, std::chrono::milliseconds(60000)};
    assert(co_await browser.screenshot_html_png(request));
    co_return Response{};
  };
  auto task = handler().take(); task.resume(); assert(task.done()); task.destroy();
}
