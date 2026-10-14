import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { readBounded } from '../lib/body.mjs';

export async function awaitScheduled(request, {
  timeoutMs = Number(process.env.LIBCF_LIVE_CRON_TIMEOUT_MS ?? 1200000),
  retryMs = 20000,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000 ||
      !Number.isInteger(retryMs) || retryMs < 1 || retryMs > 60000) {
    throw new RangeError('Cron timeout must be 1..3600000 ms; retry must be 1..60000 ms');
  }
  // One deadline covers HTTP, bounded body consumption and retry sleeps.
  const deadline = AbortSignal.timeout(timeoutMs);
  try {
    while (true) {
      deadline.throwIfAborted();
      const response = await request('/scheduled-status', { signal: deadline });
      const cron = new TextDecoder().decode(await readBounded(response.body, 65536, deadline));
      deadline.throwIfAborted();
      if (response.status === 200) {
        const scheduledTime = Number(response.headers.get('x-scheduled-time'));
        assert.equal(cron, '* * * * *');
        assert(Number.isSafeInteger(scheduledTime) && scheduledTime > 0 && scheduledTime % 60000 === 0);
        assert(Math.abs(Date.now() - scheduledTime) < 30 * 60 * 1000);
        return { cron, scheduledTime };
      }
      assert.equal(response.status, 404);
      await delay(retryMs, undefined, { signal: deadline });
    }
  } catch (error) {
    if (deadline.aborted) throw new Error(`No real Cron invocation observed within ${timeoutMs} ms`, { cause: error });
    throw error;
  }
}
