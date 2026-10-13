import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { liveHttp, awaitCertificate } from "./live-http.mjs";
const host = process.argv[2];
const request = liveHttp(host, "rate-limit");
await awaitCertificate(request);
async function limit(key, path = "/limit") {
  const response = await request(path, { method: "POST", body: key });
  await response.arrayBuffer();
  return response.status;
}
const key = `libcf-live:${randomUUID()}`;
assert.equal(await limit(key), 200);
let exceeded = false;
let attempts = 0;
for (; attempts < 40; attempts++) {
  const status = await limit(key);
  assert([200, 429].includes(status));
  if (status === 429) {
    exceeded = true;
    break;
  }
}
assert(exceeded, "No exceeded outcome observed in bounded same-key probe");
assert.equal(await limit(`libcf-live:${randomUUID()}`), 200);
assert.equal(await limit(key, "/other"), 200);
assert.equal(await limit(key, "/missing"), 502);
assert.equal(await limit("x".repeat(65537)), 502);
// These are approximate, location-scoped counters. Do not assert exact allowed
// counts or precise reset timing from a distributed live deployment.
await new Promise((resolve) => setTimeout(resolve, 12000));
let recovered = false;
for (let attempt = 0; attempt < 4; attempt++) {
  const status = await limit(key);
  assert([200, 429].includes(status));
  if (status === 200) {
    recovered = true;
    break;
  }
  if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 5000));
}
assert(recovered, "No recovery observed after bounded window wait");
console.log(
  JSON.stringify({
    host,
    passed: [
      "allowed/exceeded",
      "key/namespace isolation",
      "binding errors",
      "key limit",
      "later recovery",
    ],
    requestsAfterFirstBeforeExceeded: attempts + 1,
    scope: "one client/location; not a global quota or exact counter proof",
  }),
);
