import assert from 'node:assert/strict';
import { liveHttp, awaitCertificate } from './live-http.mjs';
const host = process.argv[2];
const request = liveHttp(host, 'clock');
await awaitCertificate(request);
async function sample(path, count) {
  const before = Date.now();
  const response = await request(path);
  const body = await response.text();
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}: ${body}`);
  const tokens = body.split(' ');
  assert.equal(tokens.length, count);
  for (const token of tokens) assert.match(token, /^-?\d{1,17}$/);
  const values = tokens.map(Number);
  const after = Date.now();
  for (const value of values) {
    assert(Number.isSafeInteger(value) && Math.abs(value) <= 8640000000000000);
    assert(value >= before - 300000 && value <= after + 300000, 'five-minute plausibility window, not clock sync');
  }
  const reference = ['x-js-clock-before', 'x-js-clock-after'].map(name => {
    const text = response.headers.get(name);
    assert.match(text ?? '', /^-?\d{1,17}$/);
    const value = Number(text);
    assert(Number.isSafeInteger(value));
    return value;
  });
  for (const value of values) assert(value >= Math.min(...reference) && value <= Math.max(...reference));
  return values;
}
await sample('/now', 1);
const synchronous = await sample('/same-turn', 33);
assert(synchronous.every(value => value === synchronous[0]), 'production clock changed without I/O');
await sample('/after-sleep', 2);
await Promise.all(Array.from({ length: 8 }, () => sample('/now', 1)));
console.log(JSON.stringify({ host, passed: ['f64 Unix milliseconds', 'same-turn frozen clock',
  'post-I/O sampling', 'same-invocation JS bracket', 'concurrent requests'], precisionGuarantee: false, monotonicGuarantee: false }, null, 2));
