import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEventWorker } from '../lib/events.mjs';

const unreachable = async () => { assert.fail('Invalid event must not enter Wasm'); };
test('unsupported structured Queue payloads are retried, not silently acknowledged', async () => {
  const worker = createEventWorker(unreachable, null);
  let acked = false;
  let retried = false;
  await worker.queue({ queue: 'test', messages: [{
    id: 'id', attempts: 1, timestamp: new Date(), body: { unsupported: true },
    ack() { acked = true; }, retry() { retried = true; },
  }] }, {}, {});
  assert.equal(acked, false);
  assert.equal(retried, true);
});

test('reserved event bindings cannot override adapter event identity', () => {
  const worker = createEventWorker(unreachable, null);
  assert.throws(() => worker.fetch(new Request('https://example.test'), { __LIBCF_EVENT_KIND: 'queue' }, {}), /reserved/);
});

test('unsafe scheduled timestamps fail before invoking C++', async () => {
  const worker = createEventWorker(unreachable, null);
  await assert.rejects(worker.scheduled({ cron: '* * * * *', scheduledTime: NaN }, {}, {}), /event integer/);
});
