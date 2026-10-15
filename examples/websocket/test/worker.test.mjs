import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { startLocalWorker } from "../../test/local-worker.mjs";
let worker;
const sockets = new Set();
before(async () => {
  worker = await startLocalWorker("examples/websocket/wrangler.jsonc");
});
after(async () => {
  for (const socket of sockets) socket.close();
  await worker?.dispose();
});
function event(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`WebSocket ${type} timeout`));
    }, 5000);
    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener(type, done);
      socket.removeEventListener("error", failed);
    }
    function done(value) {
      cleanup();
      resolve(value);
    }
    function failed() {
      cleanup();
      reject(new Error("WebSocket error"));
    }
    socket.addEventListener(type, done, { once: true });
    if (type !== "close") socket.addEventListener("error", failed, { once: true });
  });
}
async function connect(room = randomUUID()) {
  const socket = new WebSocket(`${worker.base.replace("http:", "ws:")}/rooms/${room}/connect`);
  socket.binaryType = "arraybuffer";
  sockets.add(socket);
  await event(socket, "open");
  return { socket, room };
}
async function exchange(socket, payload) {
  const received = event(socket, "message");
  socket.send(payload);
  return (await received).data;
}

test("C++ accepts upgrades and echoes text/binary after durable writes", async () => {
  const { socket, room } = await connect();
  assert.equal(await exchange(socket, "hello ☁"), "hello ☁");
  const bytes = Uint8Array.of(0, 255, 128, 65);
  assert.deepEqual(new Uint8Array(await exchange(socket, bytes)), bytes);
  assert.equal(await (await fetch(`${worker.base}/rooms/${room}/stats`)).text(), "2");
  const other = await connect();
  assert.equal(await (await fetch(`${worker.base}/rooms/${other.room}/stats`)).text(), "0");
  const closed = event(socket, "close");
  socket.close(1000, "client done");
  assert.equal((await closed).code, 1000);
  for (let attempt = 0; attempt < 30; attempt++) {
    const stats = await fetch(`${worker.base}/rooms/${room}/stats`);
    if (stats.headers.get("x-closes") === "1") {
      assert.equal(stats.headers.get("x-last-code"), "1000");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("C++ close handler did not persist its effect");
});

test("hibernating eviction preserves the socket and reconstructs C++ state", async () => {
  const { socket, room } = await connect();
  assert.equal(await exchange(socket, "before"), "before");
  const before = await fetch(`${worker.base}/rooms/${room}/stats`);
  assert.equal(before.headers.get("x-initializations"), "1");
  await before.arrayBuffer();
  await worker.evictDurable("Room", { name: room, webSockets: "hibernate" });
  assert.equal(await exchange(socket, "after"), "after");
  const after = await fetch(`${worker.base}/rooms/${room}/stats`);
  assert.equal(after.headers.get("x-initializations"), "2");
  assert.equal(await after.text(), "2");
});

test("server close and handler failure produce explicit close codes", async () => {
  const normal = await connect();
  const closed = event(normal.socket, "close");
  normal.socket.send("close");
  const close = await closed;
  assert.equal(close.code, 1000);
  assert.equal(close.reason, "bye");
  const failed = await connect();
  const failure = event(failed.socket, "close");
  failed.socket.send("fail");
  assert.equal((await failure).code, 1011);
});

test("oversized frames close without invoking C++ message handling", async () => {
  const { socket, room } = await connect();
  const closed = event(socket, "close");
  socket.send(new Uint8Array(1024 * 1024 + 1));
  assert.equal((await closed).code, 1009);
  assert.equal(await (await fetch(`${worker.base}/rooms/${room}/stats`)).text(), "0");
});

test("C++ upgrade decisions cannot upgrade an ordinary HTTP request", async () => {
  assert.equal((await fetch(`${worker.base}/rooms/check/connect`)).status, 426);
  assert.equal((await fetch(`${worker.base}/rooms/check/deny`)).status, 403);
});
