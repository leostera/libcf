#pragma once

#include "cf/detail/header_wire.hpp"
#include "cf/detail/wire.hpp"
#include "cf/env.hpp"
#include "cf/operation.hpp"

namespace cf {
struct InboundEmail {
  // SMTP envelope metadata is not proof of sender identity/authentication.
  std::string from;
  std::string to;
  Headers headers;
  Bytes raw;
};

inline Result<InboundEmail> email_message(const Env& env, Request request) {
  const auto invalid = [] {
    return Result<InboundEmail>::failure({ErrorCode::InvalidInput, "invalid email event"});
  };
  const auto from = env.var("__LIBCF_EMAIL_FROM");
  const auto to = env.var("__LIBCF_EMAIL_TO");
  if (env.var("__LIBCF_EMAIL_EVENT") != "email" || !from || !to || to->empty() || request.body.size() > 1024 * 1024)
    return invalid();
  detail::WireReader wire({reinterpret_cast<const std::uint8_t*>(request.body.data()), request.body.size()});
  Bytes header_bytes;
  Bytes raw;
  if (!wire.bytes(header_bytes) || header_bytes.size() > 65536 || !wire.bytes(raw) || !wire.done())
    return invalid();
  auto headers = detail::parse_headers(header_bytes);
  if (!headers) return invalid();
  return Result<InboundEmail>::success({*from, *to, std::move(*headers), std::move(raw)});
}

inline Response email_consume() {
  Response response;
  response.headers.append("x-libcf-email-action", "consume");
  return response;
}
inline Response email_reject(std::string reason) {
  if (reason.empty() || reason.size() > 512 || reason.find_first_of("\r\n") != std::string::npos || reason.find('\0') != std::string::npos)
    return Response::text("invalid email rejection reason", 500);
  auto response = Response::text(std::move(reason));
  response.headers.append("x-libcf-email-action", "reject");
  return response;
}
inline Response email_forward(std::string destination) {
  if (destination.empty() || destination.size() > 320 || destination.find('@') == std::string::npos ||
      destination.find_first_of("\r\n") != std::string::npos || destination.find('\0') != std::string::npos)
    return Response::text("invalid email destination", 500);
  Response response;
  response.headers.append("x-libcf-email-action", "forward");
  response.headers.append("x-libcf-email-destination", std::move(destination));
  return response;
}
}  // namespace cf
