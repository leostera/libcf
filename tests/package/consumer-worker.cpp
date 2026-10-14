#include <cf/worker.hpp>

namespace cf {
Task handle(Request, WorkerContext) {
  co_return Response::text("external package works");
}
}  // namespace cf
