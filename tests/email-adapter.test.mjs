import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeEmail, applyEmailResponse, createEmailWorker } from "../lib/email.mjs";

function message(raw = Uint8Array.of(0, 255, 65)) {
  return {
    from: "",
    to: "inbox@example.test",
    rawSize: raw.length,
    headers: new Headers({ "content-length": "999999999" }),
    raw: new Response(raw).body,
  };
}
test("email header framing preserves opaque MIME bytes without trusting Content-Length", async () => {
  const wire = await encodeEmail(message());
  const view = new DataView(wire.buffer);
  const headerSize = view.getUint32(0, true);
  assert(headerSize > 0);
  assert.equal(view.getUint32(4 + headerSize, true), 3);
  assert.deepEqual(wire.slice(8 + headerSize), Uint8Array.of(0, 255, 65));
});

test("email size mismatch and actual oversize fail with bounded stream cancellation", async () => {
  const wrongSize = message();
  wrongSize.rawSize = 2;
  await assert.rejects(encodeEmail(wrongSize), /size metadata mismatch/);
  let cancelled = false;
  const large = message();
  large.raw = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(encodeEmail(large), /exceeds/);
  assert(cancelled);
});

test("email disposition and forwarding failures propagate without silent consumption", async () => {
  await assert.rejects(applyEmailResponse({}, new Response()), /missing explicit/);
  const response = () =>
    new Response(null, {
      headers: {
        "x-libcf-email-action": "forward",
        "x-libcf-email-destination": "archive@example.test",
      },
    });
  let attempted = false;
  await assert.rejects(
    applyEmailResponse(
      {
        canBeForwarded: false,
        forward() {
          attempted = true;
        },
      },
      response(),
    ),
    /invalid/,
  );
  assert.equal(attempted, false);
  await assert.rejects(
    applyEmailResponse(
      {
        async forward() {
          throw new Error("destination not verified");
        },
      },
      response(),
    ),
    /not verified/,
  );
  await assert.rejects(
    applyEmailResponse(
      {
        setReject() {
          assert.fail("invalid reject");
        },
      },
      new Response("bad\nreason", {
        headers: { "x-libcf-email-action": "reject" },
      }),
    ),
    /invalid/,
  );
});

test("reserved email metadata cannot be supplied by an environment binding", () => {
  const worker = createEmailWorker(() => {
    assert.fail("must not instantiate");
  }, null);
  assert.throws(
    () => worker.fetch(new Request("https://example.test"), { __LIBCF_EMAIL_EVENT: "email" }, {}),
    /reserved/,
  );
});
