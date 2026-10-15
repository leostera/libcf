import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { liveHttp, awaitCertificate } from "./live-http.mjs";

const host = process.argv[2];
const request = liveHttp(host, "kv");
await awaitCertificate(request);
const suffix = randomUUID();
const empty = `empty-${suffix}`;
const binary = `binary-${suffix}`;
const metadata = `metadata-${suffix}`;
const listed = [`item:${suffix}:a`, `item:${suffix}:b`];
const invalid = `invalid-${suffix}`;
const keys = [empty, binary, metadata, ...listed, invalid];
async function eventually(check, description) {
  // KV is eventually consistent. Retries are bounded and only apply to reads;
  // writes are never blindly retried (KV also limits writes to the same key).
  for (let attempt = 0; attempt < 21; attempt++) {
    if (await check()) return;
    if (attempt < 20) await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  assert.fail(`KV did not converge within 80 seconds: ${description}`);
}
try {
  assert.equal((await request(`/items/${empty}`)).status, 404);
  assert.equal((await request(`/items/${empty}`, { method: "PUT", body: "" })).status, 201);
  await eventually(async () => {
    const response = await request(`/items/${empty}`);
    const body = await response.text();
    return response.status === 200 && body === "";
  }, "empty value after a cached miss");
  const bytes = Uint8Array.of(0, 255, 128, 65, 0);
  assert.equal((await request(`/bytes/${binary}`, { method: "PUT", body: bytes })).status, 201);
  await eventually(async () => {
    const response = await request(`/bytes/${binary}`);
    const actual = new Uint8Array(await response.arrayBuffer());
    return response.status === 200 && Buffer.from(actual).equals(bytes);
  }, "binary roundtrip");
  assert.equal(
    (
      await request(`/items/${metadata}`, {
        method: "PUT",
        body: "value",
        headers: { "x-ttl": "60", "x-metadata": '{"source":"cpp"}' },
      })
    ).status,
    201,
  );
  await eventually(async () => {
    const response = await request(`/metadata/${metadata}`);
    if (response.status !== 200) {
      await response.arrayBuffer();
      return false;
    }
    const result = await response.json();
    return result.value === "value" && result.metadata?.source === "cpp";
  }, "metadata");
  for (const key of listed)
    assert.equal((await request(`/items/${key}`, { method: "PUT", body: key })).status, 201);
  await eventually(async () => {
    const response = await request("/list");
    assert.equal(response.status, 200);
    const page = await response.json();
    assert(page.keys.every((key) => key.startsWith("item:")));
    return listed.every((key) => page.keys.includes(key));
  }, "prefix pagination");
  assert.equal(
    (
      await request(`/items/${invalid}`, {
        method: "PUT",
        body: "must not write",
        headers: { "x-metadata": 'null,"expirationTtl":60' },
      })
    ).status,
    502,
  );
  assert.equal((await request(`/items/${invalid}`)).status, 404);
} finally {
  await new Promise((resolve) => setTimeout(resolve, 1100));
  for (const key of keys)
    assert.equal((await request(`/items/${key}`, { method: "DELETE" })).status, 200);
}
await eventually(async () => {
  const response = await request(`/items/${empty}`);
  await response.arrayBuffer();
  return response.status === 404;
}, "deletion");
console.log(
  JSON.stringify({
    host,
    passed: [
      "empty/missing",
      "binary",
      "metadata/TTL acceptance",
      "prefix pagination",
      "invalid metadata",
      "delete",
    ],
    scope: "bounded eventual reads; no TTL-expiry or geographic claim",
  }),
);
