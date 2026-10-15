import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { liveHttp, awaitCertificate } from "./live-http.mjs";

const host = process.argv[2];
const request = liveHttp(host, "core");
await awaitCertificate(request);
const hello = await request("/hello/Ada");
assert.equal(hello.status, 200);
assert.equal(await hello.text(), "Hello, Ada!");
assert.equal((await request("/hello/Ada", { method: "POST" })).status, 405);
assert.equal(await (await request("/env/GREETING")).text(), "hello-from-env");
assert.equal((await request("/env/MISSING")).status, 404);
assert.equal(
  await (await request("/header", { headers: { "x-greeting": "from-live-client" } })).text(),
  "from-live-client",
);
const asset = await request("/asset");
assert.equal(asset.status, 200);
assert.equal(await asset.text(), "C++[fetched-from-assets\n]");
const bytes = Uint8Array.of(0, 1, 127, 128, 254, 255);
const echo = await request("/echo", { method: "POST", body: bytes });
assert.equal(echo.status, 200);
assert.equal(echo.headers.get("x-libcf"), "cpp");
assert.deepEqual(new Uint8Array(await echo.arrayBuffer()), bytes);
const stream = await request("/stream/32");
assert.equal(stream.status, 200);
assert.equal(await stream.text(), Array.from({ length: 32 }, (_, i) => `chunk-${i}\n`).join(""));
assert.equal((await request("/stream/129")).status, 400);
const cancelled = await request("/stream/128");
const reader = cancelled.body.getReader();
assert(new TextDecoder().decode((await reader.read()).value).startsWith("chunk-0\n"));
await reader.cancel();
assert.equal((await request("/hello/after-cancel")).status, 200);
const one = await (await request("/uuid")).text();
const two = await (await request("/uuid")).text();
assert.match(one, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.notEqual(one, two);
const names = Array.from({ length: 8 }, (_, i) => `parallel-${i}`);
assert.deepEqual(
  await Promise.all(names.map(async (name) => (await request(`/hello/${name}`)).text())),
  names.map((name) => `Hello, ${name}!`),
);
const key = `live-${randomUUID()}`;
assert.equal(
  (await request(`/background/${key}`, { method: "POST", body: "background persisted" })).status,
  202,
);
let value;
for (let attempt = 0; attempt < 21; attempt++) {
  const response = await request(`/background-status?key=${key}`);
  const text = await response.text();
  if (response.status === 200) {
    value = text;
    break;
  }
  assert.equal(response.status, 404);
  if (attempt < 20) await new Promise((resolve) => setTimeout(resolve, 4000));
}
assert.equal(value, "background persisted");
console.log(
  JSON.stringify({
    host,
    passed: [
      "routing",
      "headers/env",
      "Assets.fetch",
      "binary echo",
      "stream and client cancel/recovery",
      "UUID",
      "concurrency",
      "waitUntil KV write",
    ],
    caveat:
      "does not establish transport backpressure or geographic consistency; delete the isolated namespace afterward",
  }),
);
