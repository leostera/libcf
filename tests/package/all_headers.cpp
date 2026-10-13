#include <cf/analytics.hpp>
#include <cf/async.hpp>
#include <cf/cache.hpp>
#include <cf/context.hpp>
#include <cf/crypto.hpp>
#include <cf/d1.hpp>
#include <cf/durable_object.hpp>
#include <cf/durable_storage.hpp>
#include <cf/email.hpp>
#include <cf/env.hpp>
#include <cf/events.hpp>
#include <cf/fetch.hpp>
#include <cf/http.hpp>
#include <cf/http_client.hpp>
#include <cf/kv.hpp>
#include <cf/metadata.hpp>
#include <cf/operation.hpp>
#include <cf/pipeline.hpp>
#include <cf/queue.hpp>
#include <cf/r2.hpp>
#include <cf/rate_limit.hpp>
#include <cf/result.hpp>
#include <cf/router.hpp>
#include <cf/service.hpp>
#include <cf/sql.hpp>
#include <cf/stream.hpp>
#include <cf/subtle_crypto.hpp>
#include <cf/task.hpp>
#include <cf/timer.hpp>
#include <cf/websocket.hpp>
#include <cf/worker_loader.hpp>
#include <cf/workflow.hpp>
#include <cf/worker.hpp>

#ifdef _MSVC_LANG
constexpr auto language_version = _MSVC_LANG;
#else
constexpr auto language_version = __cplusplus;
#endif
#if CF_CONSUMER_STANDARD == 20
static_assert(language_version == 202002L);
#elif CF_CONSUMER_STANDARD == 23
static_assert(language_version > 202002L);
#else
#error Expected a C++20 or C++23 consumer
#endif

int main() {
  return cf::Response::text("installed headers work together").status == 200 ? 0 : 1;
}
