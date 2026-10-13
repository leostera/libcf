#include "libcf/http.hpp"
#include "libcf/router.hpp"

int main() {
  libcf::Router router;
  if (!router.route("GET", "/", [](const auto&, const auto&) {
    return libcf::Response::text("installed package works");
  })) return 1;
  return router.dispatch({"GET", "https://example.test/", {}, ""}).status == 200 ? 0 : 2;
}
