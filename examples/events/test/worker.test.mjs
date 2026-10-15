import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { startLocalWorker } from "../../test/local-worker.mjs";
let worker;
let base;
before(async () => {
  worker = await startLocalWorker("examples/events/test/local.wrangler.jsonc");
  base = worker.base;
});
after(async () => {
  await worker?.dispose();
});
async function delivered(body) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/lookup`, { method: "POST", body });
    if (response.status === 200) return response;
    assert.equal(response.status, 404);
    await response.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Queue delivery timed out for synthetic payload ${JSON.stringify(body)}`);
}

test("C++ producer and consumer preserve text and bytes", async () => {
  const text = randomUUID();
  assert.equal((await fetch(`${base}/send/text`, { method: "POST", body: text })).status, 202);
  const textResult = await delivered(text);
  assert.equal(textResult.headers.get("x-body-format"), "text");
  assert.equal(await textResult.text(), text);
  const bytes = Uint8Array.of(0, 255, 128, 65);
  assert.equal((await fetch(`${base}/send/bytes`, { method: "POST", body: bytes })).status, 202);
  const bytesResult = await delivered(bytes);
  assert.equal(bytesResult.headers.get("x-body-format"), "bytes");
  assert.deepEqual(new Uint8Array(await bytesResult.arrayBuffer()), bytes);
});

test("C++ Queue text preserves leading U+FEFF through native delivery and storage", async () => {
  const bom = String.fromCodePoint(0xFEFF);
  for (const prefix of [bom, bom + bom]) {
    const text = prefix + randomUUID();
    const sent = await fetch(`${base}/send/text`, { method: "POST", body: text });
    assert.equal(sent.status, 202);
    await sent.arrayBuffer();
    const result = await delivered(text);
    assert.equal(result.headers.get("x-body-format"), "text");
    // Response.text() itself removes a leading UTF-8 BOM; compare raw bytes.
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new TextEncoder().encode(text));
  }
});

test("C++ text batch delivers 100 distinct messages through native Queue and D1", {timeout:30000}, async () => {
  const messages = Array.from({length:100},(_,i)=>i === 2 ? '' :
    (i === 0 ? String.fromCodePoint(0xFEFF) : '') + randomUUID());
  const sent = await fetch(`${base}/send/batch-text`, {method:'POST',body:messages.join('\n')});
  assert.equal(sent.status,202); await sent.arrayBuffer();
  for (const text of messages) {
    const response = await delivered(text);
    assert.equal(response.headers.get('x-body-format'),'text');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new TextEncoder().encode(text));
  }
  for (const body of [Array(101).fill('x').join('\n'),'x'.repeat(128000),'before'+String.fromCharCode(0)+'after']) {
    const rejected = await fetch(`${base}/send/batch-text`, {method:'POST',body});
    assert.equal(rejected.status,502); await rejected.arrayBuffer();
  }
  const recovered = randomUUID();
  const recovery = await fetch(`${base}/send/batch-text`,{method:'POST',body:recovered});
  assert.equal(recovery.status,202); await recovery.arrayBuffer();
  assert.equal(await (await delivered(recovered)).text(),recovered);
});

test('pinned native text-batch producer truncates NUL while direct consumer injection preserves it', async () => {
  const prefix = randomUUID(), original = prefix + String.fromCharCode(0) + 'tail';
  const injected = await worker.queue('libcf-events-local', [{id:randomUUID(),body:original,attempts:1,timestamp:new Date()}]);
  assert.equal(injected.outcome,'ok');
  assert.deepEqual(new Uint8Array(await (await delivered(original)).arrayBuffer()),new TextEncoder().encode(original));
  const sent = await fetch(`${base}/control/send-batch`,{method:'POST',body:original});
  assert.equal(sent.status,202); await sent.arrayBuffer();
  assert.equal(await (await delivered(prefix)).text(),prefix);
  const received = await (await fetch(`${base}/control/received`)).json();
  assert(received.some(value=>value.text === prefix),'truncation precedes libcf consumer handling');
});

test("default example refuses batch producers without the local opt-in", async () => {
  const guarded = await startLocalWorker('examples/events/wrangler.jsonc');
  try {
    const response = await fetch(`${guarded.base}/send/batch-text`,{method:'POST',body:'not-enqueued'});
    assert.equal(response.status,403);
    assert.equal(await response.text(),'batch producer disabled');
  } finally { await guarded.dispose(); }
});

test("explicit retry redelivers before acknowledgement", async () => {
  const text = `retry:${randomUUID()}`;
  assert.equal((await fetch(`${base}/send/text`, { method: "POST", body: text })).status, 202);
  const response = await delivered(text);
  assert.equal(response.headers.get("x-attempts"), "2");
  assert.equal(await response.text(), text);
});

test("concurrent batch metadata stays isolated and duplicate message IDs are idempotent", async () => {
  const messages = Array.from({ length: 16 }, () => ({
    id: randomUUID(),
    body: randomUUID(),
    attempts: 1,
    timestamp: new Date(),
  }));
  const result = await worker.queue("libcf-events-local", messages);
  assert.equal(result.outcome, "ok");
  assert.deepEqual(result.retryMessages, []);
  for (const message of messages) {
    const response = await delivered(message.body);
    assert.equal(response.headers.get("x-copies"), "1");
    assert.equal(await response.text(), message.body);
  }
  const duplicate = await worker.queue("libcf-events-local", [{ ...messages[0], attempts: 2 }]);
  assert.equal(duplicate.outcome, "ok");
  const stored = await delivered(messages[0].body);
  assert.equal(stored.headers.get("x-copies"), "1");
  assert.equal(stored.headers.get("x-attempts"), "1");
});

test("scheduled controller metadata reaches C++ and durable storage", async () => {
  const scheduledTime = new Date("2026-10-13T12:00:00.000Z");
  const result = await worker.scheduled({ scheduledTime, cron: "* * * * *" });
  assert.equal(result.outcome, "ok");
  const response = await fetch(`${base}/scheduled-status`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "* * * * *");
  assert.equal(response.headers.get("x-scheduled-time"), String(scheduledTime.getTime()));
});

test("scheduled handler failure is not reported as successful delivery", async () => {
  const result = await worker.scheduled({ cron: "fail-for-test" });
  assert.notEqual(result.outcome, "ok");
});

test("oversized Queue message rejects before sending", async () => {
  const response = await fetch(`${base}/send/bytes`, {
    method: "POST",
    body: new Uint8Array(128_000),
  });
  assert.equal(response.status, 502);
});
