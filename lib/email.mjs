import { createWorker } from "./runtime.mjs";
import { encodeHeaders } from "./header-wire.mjs";
import { readBounded } from "./body.mjs";
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function eventEnv(env, metadata) {
  if (Object.keys(env).some((key) => key.startsWith("__LIBCF_EMAIL_")))
    throw new Error("reserved email binding conflict");
  return { ...env, ...metadata };
}
export async function encodeEmail(message) {
  if (
    !Number.isSafeInteger(message.rawSize) ||
    message.rawSize < 0 ||
    typeof message.from !== "string" ||
    typeof message.to !== "string" ||
    !message.to
  )
    throw new TypeError("invalid email metadata");
  const headers = encodeHeaders(message.headers);
  const limit = 1024 * 1024 - headers.length - 8;
  if (message.rawSize > limit) {
    await message.raw.cancel("email size limit");
    throw new RangeError("email exceeds bridge budget");
  }
  const raw = await readBounded(message.raw, limit);
  if (raw.length !== message.rawSize) throw new Error("email size metadata mismatch");
  const body = new Uint8Array(8 + headers.length + raw.length);
  const view = new DataView(body.buffer);
  view.setUint32(0, headers.length, true);
  body.set(headers, 4);
  view.setUint32(4 + headers.length, raw.length, true);
  body.set(raw, 8 + headers.length);
  return body;
}
export async function applyEmailResponse(message, response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("C++ email handler failed");
  }
  const action = response.headers.get("x-libcf-email-action");
  if (action === "reject") {
    const reason = decoder.decode(await readBounded(response.body, 512));
    if (!reason || /[\r\n\0]/.test(reason)) throw new TypeError("invalid email rejection reason");
    message.setReject(reason);
    return;
  }
  await readBounded(response.body, 0);
  if (action === "consume") return;
  if (action === "forward") {
    const destination = response.headers.get("x-libcf-email-destination");
    if (
      message.canBeForwarded === false ||
      !destination ||
      encoder.encode(destination).length > 320 ||
      !destination.includes("@") ||
      /[\r\n\0]/.test(destination)
    )
      throw new TypeError("invalid email forwarding");
    await message.forward(destination);
    return;
  }
  throw new Error("missing explicit email disposition");
}
export function createEmailWorker(factory, wasm) {
  const application = createWorker(factory, wasm);
  return {
    fetch(request, env, ctx) {
      return application.fetch(request, eventEnv(env, { __LIBCF_EMAIL_EVENT: "fetch" }), ctx);
    },
    async email(message, env, ctx) {
      const metadata = eventEnv(env, {
        __LIBCF_EMAIL_EVENT: "email",
        __LIBCF_EMAIL_FROM: message.from,
        __LIBCF_EMAIL_TO: message.to,
      });
      // Encode email headers separately: an untrusted MIME Content-Length must
      // never become HTTP framing for the synthetic request into Wasm.
      const response = await application.fetch(
        new Request("https://libcf.internal/email", {
          method: "POST",
          body: await encodeEmail(message),
        }),
        metadata,
        ctx,
      );
      await applyEmailResponse(message, response);
    },
  };
}
