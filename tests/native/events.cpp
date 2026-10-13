#include <cassert>
#include <map>
#include "cf/events.hpp"
#include "cf/queue.hpp"
#include "cf/task.hpp"

int main() {
  using namespace cf;
  std::map<std::string, std::string> fields{
    {"__LIBCF_EVENT_KIND", "queue"}, {"__LIBCF_EVENT_ID", "message-1"},
    {"__LIBCF_EVENT_QUEUE", "test"}, {"__LIBCF_EVENT_FORMAT", "bytes"},
    {"__LIBCF_EVENT_ATTEMPTS", "2"}, {"__LIBCF_EVENT_TIME", "1234"},
  };
  Env env([&](std::string_view key) -> std::optional<std::string> {
    const auto it = fields.find(std::string(key));
    return it == fields.end() ? std::nullopt : std::optional(it->second);
  });
  Request request{"POST", "https://example.test", {}, std::string("a\0b", 3)};
  auto message = queue_message(env, request);
  assert(message && message.value().attempts == 2);
  assert(message.value().timestamp.time_since_epoch().count() == 1234);
  assert(std::get<Bytes>(message.value().body) == (Bytes{'a', 0, 'b'}));
  fields["__LIBCF_EVENT_ATTEMPTS"] = "0";
  assert(!queue_message(env, request));
  fields["__LIBCF_EVENT_KIND"] = "scheduled";
  fields["__LIBCF_EVENT_CRON"] = "* * * * *";
  assert(scheduled_event(env));
  fields["__LIBCF_EVENT_TIME"] = "9007199254740992";
  assert(!scheduled_event(env));
  assert(queue_ack().headers.get("x-libcf-queue-action") == "ack");
  assert(queue_retry(std::chrono::seconds{-1}).status == 500);
  assert(queue_retry(std::chrono::seconds{86401}).status == 500);

  bool called = false;
  BindingRuntime runtime([&](auto, auto) { called = true; }, [](auto) {});
  Queue queue(runtime, "EVENTS");
  auto handler = [&]() -> Task {
    auto bad_delay = co_await queue.send_text("x", std::chrono::seconds{-1});
    assert(!bad_delay);
    auto oversized = co_await queue.send_bytes(Bytes(128 * 1024));
    assert(!oversized);
    co_return queue_ack();
  };
  auto task = handler().take();
  task.resume();
  assert(task.done() && !called);
  task.destroy();
}
