import assert from "node:assert/strict";
import { test } from "node:test";
import { socketMessage, applySocketResponse } from "../lib/websocket.mjs";

test("WebSocket input distinguishes text and bytes and enforces byte size", () => {
  assert.equal(socketMessage("☁").metadata.__LIBCF_WS_FORMAT, "text");
  assert.equal(socketMessage(new Uint8Array([0, 255]).buffer).metadata.__LIBCF_WS_FORMAT, "bytes");
  assert.throws(() => socketMessage({}), /invalid native/);
  assert.throws(() => socketMessage("☁".repeat(400000)), /exceeds/);
});

test("WebSocket responses reject missing dispositions and malformed UTF-8", async () => {
  const socket = {
    send() {
      assert.fail("invalid response must not send");
    },
  };
  await assert.rejects(applySocketResponse(socket, new Response("ordinary response")), /missing/);
  await assert.rejects(
    applySocketResponse(
      socket,
      new Response(Uint8Array.of(255), {
        headers: { "x-libcf-ws-action": "send", "x-libcf-ws-format": "text" },
      }),
    ),
    /encoded data/,
  );
  await assert.rejects(
    applySocketResponse(
      socket,
      new Response("x", {
        headers: { "x-libcf-ws-action": "send", "x-libcf-ws-format": "text" },
      }),
      false,
    ),
    /terminal/,
  );
});

test("WebSocket output limit cancels before sending any oversized frame", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    applySocketResponse(
      {
        send() {
          assert.fail("oversized send");
        },
      },
      new Response(stream, {
        headers: { "x-libcf-ws-action": "send", "x-libcf-ws-format": "bytes" },
      }),
    ),
    /exceeds/,
  );
  assert(cancelled);
});

test("reserved close codes and overlong reasons never reach the native socket", async () => {
  const socket = {
    close() {
      assert.fail("invalid close");
    },
  };
  for (const [code, reason] of [
    ["1006", ""],
    ["3000", "x".repeat(124)],
  ]) {
    await assert.rejects(
      applySocketResponse(
        socket,
        new Response(reason, {
          headers: { "x-libcf-ws-action": "close", "x-libcf-ws-code": code },
        }),
      ),
    );
  }
});
