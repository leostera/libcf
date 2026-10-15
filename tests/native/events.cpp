#include "cf/events.hpp"
#include "cf/detail/wire.hpp"

#include <cassert>
#include <map>

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
    auto oversized = co_await queue.send_bytes(Bytes(128'000));
    assert(!oversized && oversized.error().code == ErrorCode::InvalidInput);
    auto oversized_text = co_await queue.send_text(std::string(128'000, 'x'));
    assert(!oversized_text && oversized_text.error().code == ErrorCode::InvalidInput);
    co_return queue_ack();
  };
  auto task = handler().take();
  task.resume();
  assert(task.done() && !called);
  task.destroy();

  int accepted = 0;
  BindingRuntime accepting([&](OperationCall call, BindingRuntime::Completion done) {
    assert(call.body.size() == 127'999);
    assert(call.method == (accepted == 0 ? Operation::QueueSendText : Operation::QueueSendBytes));
    ++accepted;
    done(Result<OperationReply>::success({ReplyKind::Value, {}}));
  }, [](auto) {});
  Queue near_limit(accepting, "EVENTS");
  auto boundary = [&]() -> Task {
    assert((co_await near_limit.send_text(std::string(127'999, 'x'))));
    assert((co_await near_limit.send_bytes(Bytes(127'999))));
    co_return queue_ack();
  };
  auto boundary_task = boundary().take();
  boundary_task.resume();
  assert(boundary_task.done() && accepted == 2);
  boundary_task.destroy();

  const auto check_batch = [&](std::vector<std::string> messages, std::chrono::seconds delay, bool valid) {
    const auto expected = messages;
    int sends = 0;
    BindingRuntime batch_runtime([&](OperationCall call, BindingRuntime::Completion done) {
      ++sends;
      assert(call.method == Operation::QueueSendTextBatch && call.binding == "EVENTS");
      assert(call.options == std::to_string(delay.count()) && call.body.size() <= 256000);
      detail::WireReader reader(call.body);
      std::uint32_t count;
      assert(reader.u32(count) && count == expected.size());
      for (const auto& text : expected) {
        std::string actual;
        assert(reader.string(actual) && actual == text);
      }
      assert(reader.done());
      done(Result<OperationReply>::success({ReplyKind::Value,{}}));
    }, [](auto) {});
    auto pending = Queue(batch_runtime,"EVENTS").send_text_batch(messages,delay);
    messages.assign(1,"caller changed");
    assert(sends == 0);
    auto check = [&]() -> Task {
      auto result = co_await std::move(pending);
      assert(static_cast<bool>(result) == valid);
      if (!valid) assert(result.error().code == ErrorCode::InvalidInput);
      co_return queue_ack();
    };
    auto checked = check().take(); checked.resume();
    assert(checked.done() && sends == (valid ? 1 : 0)); checked.destroy();
  };
  check_batch({"", "\xEF\xBB\xBFhello"},std::chrono::seconds{86400},true);
  check_batch({"ok",std::string("a\0b",3)},{},false);
  check_batch(std::vector<std::string>(100,"x"),{},true);
  check_batch({std::string(127994,'x'),std::string(127994,'y')},{},true);
  check_batch({}, {},false);
  check_batch(std::vector<std::string>(101,""),{},false);
  check_batch({std::string(128000,'x')},{},false);
  check_batch({std::string(127995,'x'),std::string(127994,'y')},{},false);
  check_batch({std::string(1,static_cast<char>(255))},{},false);
  check_batch({"x"},std::chrono::seconds{-1},false);
  check_batch({"x"},std::chrono::seconds{86401},false);

  // A send acknowledgment has exactly one valid wire shape. Failure is not a
  // safe retry signal: the provider may already have accepted the message.
  for (int method : {112, 113, 114}) {
    for (auto reply : {OperationReply{ReplyKind::Value, {}},
                       OperationReply{ReplyKind::Missing, {}},
                       OperationReply{static_cast<ReplyKind>(255), {}},
                       OperationReply{ReplyKind::Value, Bytes{1}}}) {
      const bool valid = reply.kind == ReplyKind::Value && reply.bytes.empty();
      int sends = 0;
      BindingRuntime replies([&](OperationCall, BindingRuntime::Completion done) {
        ++sends;
        done(Result<OperationReply>::success(reply));
      }, [](auto) {});
      Queue producer(replies, "EVENTS");
      auto check = [&]() -> Task {
        const std::vector<std::string> batch{"x"};
        auto result = co_await (method == 112 ? producer.send_text("x") :
            method == 113 ? producer.send_bytes(Bytes{1}) : producer.send_text_batch(batch));
        assert(static_cast<bool>(result) == valid);
        if (!valid) assert(result.error().code == ErrorCode::HostFailure);
        co_return queue_ack();
      };
      auto checked = check().take();
      checked.resume();
      assert(checked.done() && sends == 1);
      checked.destroy();
    }
  }
}
