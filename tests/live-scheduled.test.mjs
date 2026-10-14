import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awaitScheduled } from '../scripts/live-scheduled.mjs';

const scheduled = () => new Response('* * * * *', {
  headers: { 'x-scheduled-time': String(Math.floor(Date.now() / 60000) * 60000) },
});

test('scheduled observation drains misses and validates an actual controller timestamp', async () => {
  let calls = 0;
  const result = await awaitScheduled(async (path, { signal }) => {
    assert.equal(path, '/scheduled-status'); assert(signal instanceof AbortSignal);
    return ++calls === 1 ? new Response('pending', { status: 404 }) : scheduled();
  }, { timeoutMs: 1000, retryMs: 1 });
  assert.equal(calls, 2); assert.equal(result.cron, '* * * * *');
  assert.equal(result.scheduledTime % 60000, 0);
});

test('invalid budgets fail before making any request', async () => {
  let calls = 0;
  const request = async () => { calls++; return scheduled(); };
  for (const timeoutMs of [0, -1, 0.5, Infinity, NaN, 3600001]) {
    await assert.rejects(awaitScheduled(request, { timeoutMs }), RangeError);
  }
  for (const retryMs of [0, -1, 0.5, Infinity, NaN, 60001]) {
    await assert.rejects(awaitScheduled(request, { retryMs }), RangeError);
  }
  assert.equal(calls, 0);
});

test('retry sleep shares the elapsed deadline', async () => {
  await assert.rejects(awaitScheduled(async () => new Response('pending', { status: 404 }),
    { timeoutMs: 25, retryMs: 1000 }), /within 25 ms/);
});

test('stalled bodies are interrupted without awaiting stalled cancellation', async () => {
  let cancelled = false;
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const response = new Response(new ReadableStream({
      pull() { return new Promise(() => {}); },
      cancel() { cancelled = true; return new Promise(() => {}); },
    }));
    await assert.rejects(awaitScheduled(async () => response,
      { timeoutMs: 25, retryMs: 1 }), /within 25 ms/);
    assert(cancelled);
  } finally { clearInterval(keepAlive); }
});

test('unexpected status, oversized bodies and malformed scheduled results are not successes', async () => {
  for (const response of [
    new Response('failed', { status: 500 }),
    new Response('x'.repeat(65537), { status: 404 }),
    new Response('* * * * *'),
    new Response('wrong schedule', { headers: { 'x-scheduled-time': '60000' } }),
    new Response('* * * * *', { headers: { 'x-scheduled-time': '1.5' } }),
    new Response('* * * * *', { headers: { 'x-scheduled-time': '60000' } }),
  ]) {
    await assert.rejects(awaitScheduled(async () => response, { timeoutMs: 1000, retryMs: 1 }));
  }
});
