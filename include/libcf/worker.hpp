#pragma once

#include <utility>

#include "libcf/context.hpp"
#include "libcf/crypto.hpp"
#include "libcf/env.hpp"
#include "libcf/fetch.hpp"
#include "libcf/http.hpp"
#include "libcf/operation.hpp"
#include "libcf/task.hpp"

namespace libcf {

// All capabilities belong to one request. The Worker adapter provides the
// host callbacks; the handler may move this value into a coroutine frame.
struct WorkerContext {
  Env env;
  Context execution;
  Fetcher assets;
  BindingRuntime bindings;
  Crypto crypto;
};

// Define this function once in the application's C++ translation unit. It is
// lazily started, so request and context are owned by the coroutine before any
// JS Promise completes. Response streaming continues after the task finishes.
Task handle(Request request, WorkerContext context);

}  // namespace libcf
