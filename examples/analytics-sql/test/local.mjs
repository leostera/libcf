import worker from '../worker.mjs';
// Fake engine: this validates transport, not SQL syntax/semantics or account data.
const ANALYTICS = { async query(request) {
  if (this !== ANALYTICS || Object.keys(request).join(',') !== 'query,params') throw new Error('unexpected query call');
  const params = request.params;
  let label;
  if (Array.isArray(params)) {
    if (request.query !== "SELECT ? AS empty, ? AS disabled, ? AS enabled, ? AS zero, ? AS fraction, ? AS label FROM synthetic WHERE timestamp >= '2026-10-14T00:00:00Z' LIMIT 1" || params.length !== 6 || params[0] !== null || params[1] !== false || params[2] !== true || !Object.is(params[3], -0) || params[4] !== 0.25) throw new Error('bad positional parameters');
    label = params[5];
  } else {
    if (request.query !== 'SELECT value FROM synthetic WHERE timestamp >= $start AND label = $label LIMIT 1' || params.start !== '2026-10-14T00:00:00Z') throw new Error('bad named parameters');
    label = params.label;
  }
  if (label === 'throw') throw Object.assign(new Error('private provider diagnostic'), { retryable: true });
  if (label === 'slow') await new Promise(resolve => setTimeout(resolve, 200));
  const row = { label, empty: null, disabled: false, enabled: true, zero: -0, fraction: label === 'bad' ? {} : 0.25 };
  const data = label === 'empty' ? [] : label === 'too-many' ? Array(101).fill(row) : [row];
  return { data, rows: data.length, statistics: { elapsed_ms: 0.5, rows_read: 10, bytes_read: label === 'unsafe' ? 9007199254740992 : 100 },
    get toJSON() { throw new Error('unexpected serialization'); },
    [Symbol.dispose]() { if (label === 'cleanup-fail') throw new Error('cleanup failed'); } };
}, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, ANALYTICS }, ctx); } };
