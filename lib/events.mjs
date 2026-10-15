import { createWorker } from "./runtime.mjs";

function eventEnv(env, fields) {
  if (Object.keys(env).some((key) => key.startsWith("__LIBCF_EVENT_")))
    throw new Error("reserved event binding conflict");
  return { ...env, ...fields };
}
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError("invalid event integer");
  return String(value);
}
function payload(body) {
  if (typeof body === "string") return { body, format: "text" };
  if (body instanceof ArrayBuffer) return { body: new Uint8Array(body), format: "bytes" };
  if (ArrayBuffer.isView(body))
    return { body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength), format: "bytes" };
  throw new TypeError("libcf Queue consumers currently accept text or bytes only");
}

export function createEventWorker(factory, wasm) {
  const application = createWorker(factory, wasm);
  return {
    fetch(request, env, ctx) {
      return application.fetch(request, eventEnv(env, { __LIBCF_EVENT_KIND: "fetch" }), ctx);
    },
    async scheduled(controller, env, ctx) {
      const response = await application.fetch(
        new Request("https://libcf.internal/scheduled"),
        eventEnv(env, {
          __LIBCF_EVENT_KIND: "scheduled",
          __LIBCF_EVENT_CRON: controller.cron,
          __LIBCF_EVENT_TIME: integer(controller.scheduledTime),
        }),
        ctx,
      );
      if (!response.ok) throw new Error("C++ scheduled handler failed");
      await response.arrayBuffer();
    },
    async queue(batch, env, ctx) {
      // Each message has its own invocation context. No automatic ack on a 2xx
      // response: C++ must explicitly choose ack after committing its work.
      const consume = async (message) => {
        try {
          const { body, format } = payload(message.body);
          const response = await application.fetch(
            new Request("https://libcf.internal/queue", { method: "POST", body }),
            eventEnv(env, {
              __LIBCF_EVENT_KIND: "queue",
              __LIBCF_EVENT_ID: message.id,
              __LIBCF_EVENT_QUEUE: batch.queue,
              __LIBCF_EVENT_ATTEMPTS: integer(message.attempts, 1, 0xffffffff),
              __LIBCF_EVENT_TIME: integer(message.timestamp.getTime()),
              __LIBCF_EVENT_FORMAT: format,
            }),
            ctx,
          );
          await response.arrayBuffer();
          const action = response.headers.get("x-libcf-queue-action");
          if (response.ok && action === "ack") {
            message.ack();
            return;
          }
          if (response.ok && action === "retry") {
            const delay = response.headers.get("x-libcf-queue-delay");
            if (!/^\d+$/.test(delay ?? "")) throw new TypeError("invalid queue retry delay");
            integer(Number(delay), 1, 86400);
            message.retry({ delaySeconds: Number(delay) });
            return;
          }
          throw new Error("missing explicit Queue disposition");
        } catch {
          message.retry();
        }
      };
      // Bound the number of simultaneously copied message bodies/coroutines.
      // The index belongs to this batch, never to a module-global context.
      let next = 0;
      async function drain() {
        while (next < batch.messages.length) await consume(batch.messages[next++]);
      }
      await Promise.all(Array.from({ length: Math.min(8, batch.messages.length) }, drain));
    },
  };
}
