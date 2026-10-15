#include "cf/http.hpp"
#include "cf/router.hpp"

int main() {
  cf::Router router;
  if (!router.route("GET", "/", [](const auto&, const auto&) {
        return cf::Response::text("installed package works");
      }))
    return 1;
  return router.dispatch({"GET", "https://example.test/", {}, ""}).status == 200 ? 0 : 2;
}
