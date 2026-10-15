#pragma once

#include <charconv>
#include <chrono>
#include <variant>

#include "cf/env.hpp"
#include "cf/http.hpp"
#include "cf/operation.hpp"

namespace cf {
enum class WorkerEvent { Fetch, Queue, Scheduled };
using EventTime = std::chrono::time_point<std::chrono::system_clock, std::chrono::milliseconds>;
struct QueueMessage {
  std::string id;
  std::string queue;
  std::uint32_t attempts;
  EventTime timestamp;
  std::variant<std::string, Bytes> body;
};
struct ScheduledEvent {
  std::string cron;
  EventTime scheduled_time;
};

namespace detail {
inline Result<std::int64_t> event_integer(const Env& env, std::string_view key) {
  auto text = env.var(key);
  if (!text)
    return Result<std::int64_t>::failure({ErrorCode::InvalidInput, "missing event metadata"});
  std::int64_t value = 0;
  const auto [end, error] = std::from_chars(text->data(), text->data() + text->size(), value);
  if (error != std::errc{} || end != text->data() + text->size() || value < 0 ||
      value > 9007199254740991LL)
    return Result<std::int64_t>::failure({ErrorCode::InvalidInput, "invalid event integer"});
  return Result<std::int64_t>::success(value);
}
}  // namespace detail
inline Result<WorkerEvent> worker_event(const Env& env) {
  auto kind = env.var("__LIBCF_EVENT_KIND");
  if (kind == "fetch") return Result<WorkerEvent>::success(WorkerEvent::Fetch);
  if (kind == "queue") return Result<WorkerEvent>::success(WorkerEvent::Queue);
  if (kind == "scheduled") return Result<WorkerEvent>::success(WorkerEvent::Scheduled);
  return Result<WorkerEvent>::failure({ErrorCode::InvalidInput, "missing Worker event kind"});
}
inline Result<QueueMessage> queue_message(const Env& env, Request request) {
  auto kind = worker_event(env);
  auto id = env.var("__LIBCF_EVENT_ID");
  auto queue = env.var("__LIBCF_EVENT_QUEUE");
  auto format = env.var("__LIBCF_EVENT_FORMAT");
  auto attempts = detail::event_integer(env, "__LIBCF_EVENT_ATTEMPTS");
  auto time = detail::event_integer(env, "__LIBCF_EVENT_TIME");
  if (!kind || kind.value() != WorkerEvent::Queue || !id || id->empty() || !queue ||
      queue->empty() || !attempts || attempts.value() < 1 || attempts.value() > UINT32_MAX ||
      !time || (format != "text" && format != "bytes"))
    return Result<QueueMessage>::failure(
        {ErrorCode::InvalidInput, "invalid Queue message metadata"});
  QueueMessage message{std::move(*id), std::move(*queue),
                       static_cast<std::uint32_t>(attempts.value()),
                       EventTime{std::chrono::milliseconds{time.value()}}, std::string{}};
  if (format == "text")
    message.body = std::move(request.body);
  else
    message.body = Bytes(request.body.begin(), request.body.end());
  return Result<QueueMessage>::success(std::move(message));
}
inline Result<ScheduledEvent> scheduled_event(const Env& env) {
  auto kind = worker_event(env);
  auto cron = env.var("__LIBCF_EVENT_CRON");
  auto time = detail::event_integer(env, "__LIBCF_EVENT_TIME");
  if (!kind || kind.value() != WorkerEvent::Scheduled || !cron || !time)
    return Result<ScheduledEvent>::failure(
        {ErrorCode::InvalidInput, "invalid scheduled event metadata"});
  return Result<ScheduledEvent>::success(
      {std::move(*cron), EventTime{std::chrono::milliseconds{time.value()}}});
}
inline Response queue_ack() {
  Response response;
  response.headers.append("x-libcf-queue-action", "ack");
  return response;
}
inline Response queue_retry(std::chrono::seconds delay = std::chrono::seconds{1}) {
  if (delay.count() < 1 || delay.count() > 86400) return Response::text("invalid retry delay", 500);
  Response response;
  response.headers.append("x-libcf-queue-action", "retry");
  response.headers.append("x-libcf-queue-delay", std::to_string(delay.count()));
  return response;
}
}  // namespace cf
