import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { startLocalWorker } from '../../test/local-worker.mjs';
let worker;
before(async () => { worker = await startLocalWorker('examples/ai/test/local.wrangler.jsonc'); });
after(async () => { await worker?.dispose(); });
const run = body => fetch(`${worker.base}/run`, { method: 'POST', body });

test('actual C++/Wasm dispatch preserves owned AI JSON with an explicit local mock', async () => {
  const input = { prompt: 'Hello, 世界', max_tokens: 16 };
  const response = await run(JSON.stringify(input));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { model: '@cf/meta/llama-3.2-1b-instruct', input, mocked: true });
  await Promise.all(Array.from({ length: 8 }, async (_, id) => {
    const result = await run(JSON.stringify({ prompt: String(id) }));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).input.prompt, String(id));
  }));
});

test('production AI configuration cannot silently enable remote inference in local tests', async () => {
  await assert.rejects(startLocalWorker('examples/ai/wrangler.jsonc'), /explicit local mock/);
});

test('invalid inputs, unsupported output and provider errors fail; next request recovers', async () => {
  for (const body of ['{', '[]', 'null', '{"stream":true}', '{"fixture":"error"}', '{"fixture":"binary"}']) {
    const response = await run(body);
    assert.equal(response.status, 502);
    await response.text();
  }
  const recovered = await run('{"prompt":"after failure"}');
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).input.prompt, 'after failure');
});
