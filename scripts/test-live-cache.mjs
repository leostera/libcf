import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { liveHttp, awaitCertificate } from "./live-http.mjs";

const host = process.argv[2];
const request = liveHttp(host, "cache");
await awaitCertificate(request);
const path = `/entries/${randomUUID()}`;
const body = Uint8Array.of(0, 128, 255, 65);
const namedHeaders = { "x-cache-name": `libcf-named-${randomUUID()}` };
try {
  assert.equal((await request(path)).status, 404);
  assert.equal((await request(path, { method: "PUT", body })).status, 201);
  const response = await request(path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-origin"), "cf");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body);
  assert.equal(await (await request(path, { method: "DELETE" })).text(), "deleted");
  assert.equal((await request(path)).status, 404);
  assert.equal(await (await request(path, { method: "DELETE" })).text(), "absent");
  assert.equal(
    (await request(path, { method: "PUT", body: "", headers: namedHeaders })).status,
    201,
  );
  assert.equal((await request(path)).status, 404);
  const named = await request(path, { headers: namedHeaders });
  assert.equal(named.status, 200);
  assert.equal(await named.text(), "");
  assert.equal((await request(path, { method: "PUT", body: "default" })).status, 201);
  assert.equal(await (await request(path)).text(), "default");
  assert.equal(await (await request(path, { headers: namedHeaders })).text(), "");
  assert.equal(
    await (await request(path, { method: "DELETE", headers: namedHeaders })).text(),
    "deleted",
  );
  assert.equal((await request(path, { headers: namedHeaders })).status, 404);
  assert.equal(await (await request(path)).text(), "default");
  console.log(
    JSON.stringify({
      host,
      passed: [
        "miss",
        "put",
        "binary match",
        "headers",
        "delete/absent",
        "named/default isolation",
        "named empty value",
      ],
      scope: "single client/location only",
    }),
  );
} finally {
  await request(path, { method: "DELETE" });
  await request(path, { method: "DELETE", headers: namedHeaders });
}
