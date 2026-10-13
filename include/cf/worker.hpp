#pragma once

#include <utility>

#include "cf/clock.hpp"
#include "cf/context.hpp"
#include "cf/crypto.hpp"
#include "cf/env.hpp"
#include "cf/fetch.hpp"
#include "cf/http.hpp"
#include "cf/operation.hpp"
#include "cf/task.hpp"

namespace cf {

// All capabilities belong to one request. The Worker adapter provides the
// host callbacks; the handler may move this value into a coroutine frame.
struct WorkerContext {
  Env env;
  Context execution;
  Fetcher assets;
  BindingRuntime bindings;
  Crypto crypto;
  WallClock clock;
};

// Define this function once in the application's C++ translation unit. It is
// lazily started, so request and context are owned by the coroutine before any
// JS Promise completes. Response streaming continues after the task finishes.
Task handle(Request request, WorkerContext context);

}  // namespace cf
