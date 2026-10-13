#include <cassert>
#include <map>
#include "cf/email.hpp"

int main() {
  using namespace cf;
  std::map<std::string, std::string> fields{
      {"__LIBCF_EMAIL_EVENT", "email"}, {"__LIBCF_EMAIL_FROM", ""},
      {"__LIBCF_EMAIL_TO", "inbox@example.test"}};
  Env env([&](std::string_view key) -> std::optional<std::string> {
    auto it = fields.find(std::string(key));
    return it == fields.end() ? std::nullopt : std::optional(it->second);
  });
  const auto append = [](std::string& wire, std::string_view field) {
    for (unsigned shift = 0; shift < 32; shift += 8) wire.push_back(static_cast<char>(field.size() >> shift));
    wire.append(field);
  };
  std::string wire;
  append(wire, ""); // Empty logical header list.
  append(wire, std::string("a\0\xff", 3));
  Request request{"POST", "https://example.test", {}, wire};
  auto parsed = email_message(env, request);
  assert(parsed && parsed.value().from.empty()); // SMTP null reverse path is valid.
  assert(parsed.value().raw == (Bytes{'a', 0, 255}));
  request.body.push_back('x');
  assert(!email_message(env, request));
  request.body = std::string(4, '\xff');
  assert(!email_message(env, request));
  request.body = wire;
  fields["__LIBCF_EMAIL_EVENT"] = "fetch";
  assert(!email_message(env, request));
  assert(email_consume().headers.get("x-libcf-email-action") == "consume");
  assert(email_reject("policy rejection").status == 200);
  assert(email_reject("injected\r\ncommand").status == 500);
  assert(email_reject(std::string(513, 'x')).status == 500);
  assert(email_forward("archive@example.test").status == 200);
  assert(email_forward("bad\nrecipient@example.test").status == 500);
}
