import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "../lib/runtime.mjs";

function rejectingCpp() {
  return new Proxy(
    {},
    {
      get(_, name) {
        if (name === "then") return undefined; // Promise resolution probes thenables.
        assert.fail("Rejected request must not call a C++ export");
      },
    },
  );
}

test("declared oversized body returns 413 before reading or calling C++", async () => {
  const worker = createWorker(async () => rejectingCpp(), null);
  let read = false;
  const body = new ReadableStream(
    {
      pull() {
        read = true;
        throw new Error("must not read");
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("https://example.test/echo", {
    method: "POST",
    body,
    duplex: "half",
    headers: { "content-length": String(1024 * 1024 + 1) },
  });
  assert.equal((await worker.fetch(request, {}, {})).status, 413);
  assert.equal(read, false);
  await body.cancel();
});

test("unknown-length oversized body is cancelled and returns 413 before calling C++", async () => {
  const worker = createWorker(async () => rejectingCpp(), null);
  let cancelled = false;
  const body = new ReadableStream(
    {
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("https://example.test/echo", {
    method: "POST",
    body,
    duplex: "half",
  });
  assert.equal((await worker.fetch(request, {}, {})).status, 413);
  assert.equal(cancelled, true);
});
