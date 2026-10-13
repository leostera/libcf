import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export function liveHttp(host, family) {
  if (!['cache', 'd1', 'kv', 'r2', 'core', 'service', 'durable', 'events', 'websocket', 'rate-limit', 'metadata', 'crypto'].includes(family) ||
      typeof host !== 'string' ||
      new RegExp(`^libcf-${family}-[a-f0-9]{10}\\.libcf\\.leostera\\.dev$`).exec(host)?.[0] !== host)
    throw new Error('Expected an isolated test hostname under libcf.leostera.dev');
  const origin = `https://${host}`;
  return (path, init = {}) => {
    if (typeof path !== 'string' || !path.startsWith('/'))
      throw new Error('Expected an origin-relative live test path');
    const target = new URL(path, origin);
    if (target.origin !== origin || target.username || target.password)
      throw new Error('Live test path must remain on its isolated origin');
    return fetch(target.href, {
      ...init, redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
  };
}

export async function awaitCertificate(request, expectedStatus = 404, {
  timeoutMs = Number(process.env.LIBCF_LIVE_READY_TIMEOUT_MS ?? 900000),
  retryMs = 10000,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2700000 ||
      !Number.isInteger(retryMs) || retryMs < 1 || retryMs > 10000)
    throw new RangeError('readiness timeout must be 1..2700000 ms; retry must be 1..10000 ms');
  // Retain one hostname long enough for observed negative DNS TTLs when opted
  // in. The same deadline covers requests, response bodies and retry sleeps.
  const deadline = AbortSignal.timeout(timeoutMs);
  while (true) {
    try {
      const response = await request('/libcf-readiness-missing-route', { signal: deadline });
      assert.equal(response.status, expectedStatus);
      await response.arrayBuffer();
      deadline.throwIfAborted();
      return;
    } catch (error) {
      if (deadline.aborted) throw error;
      try { await delay(retryMs, undefined, { signal: deadline }); }
      catch { throw error; }
    }
  }
}
