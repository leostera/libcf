import worker from '../worker.mjs';
const key = 'libcf-owned-flag';

// Local-only fixture administration. Never deploy this entrypoint or expose the
// simulator's private admin hook as a public libcf/application API.
export default { async fetch(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST' || !['/__seed', '/__remove'].includes(path))
    return worker.fetch(request, env, ctx);
  const mode = path === '/__seed' ? await request.text() : '';
  if (path === '/__seed' && !['static', 'targeted', 'disabled', 'wrong-type'].includes(mode))
    return new Response('unknown fixture', { status: 400 });
  const released = new WeakSet();
  function release(...values) {
    for (const value of values) {
      if (value === env.FLAGS || value === null || !['object', 'function'].includes(typeof value) || released.has(value)) continue;
      released.add(value); value[Symbol.dispose]?.();
    }
  }
  const acquisition = env.FLAGS['FlagshipBinding::admin_api']();
  let admin, call, result;
  try {
    admin = await acquisition;
    if (path === '/__remove') call = admin.deleteFlag(key);
    else call = admin.putFlag({ key, enabled: mode !== 'disabled', default_variation: 'off',
      variations: mode === 'wrong-type' ? { off: 'not a boolean' } : { off: false, on: true },
      rules: ['targeted', 'disabled'].includes(mode) ? [{ priority: 1, serve_variation: 'on',
        conditions: [{ attribute: 'targetingKey', operator: 'equals', value: 'synthetic-猫' }] }] : [] });
    result = await call;
    return new Response('fixture updated');
  } finally { release(result, call, admin, acquisition); }
} };
