import worker from '../worker.mjs';
import { syntheticVideo } from '../../media/test/video-fixture.mjs';
const owned = new Set();
function release(...values) {
  const seen = new Set();
  for (const value of values) {
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value); value[Symbol.dispose]?.();
  }
}
export default { async fetch(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (request.method === 'POST' && path === '/__fixture') {
    // Local-only simulator extension for fixture setup. NOT a public C++ upload
    // API or evidence that production Stream accepts raw streams or GIF input.
    const pending = env.STREAM.upload(new Response(syntheticVideo()).body);
    let value;
    try { value = await pending; owned.add(value.id); return Response.json({ id: value.id }); }
    finally { release(value, pending); }
  }
  if (request.method === 'POST' && path === '/__remove') {
    const id = await request.text();
    if (!owned.has(id)) return new Response('not owned', { status: 404 });
    const pending = env.STREAM.video(id); let scope, call;
    try {
      scope = await pending; call = scope.delete(); await call;
      owned.delete(id); return new Response('removed');
    } finally { release(call, scope, pending); }
  }
  return worker.fetch(request, env, ctx);
} };
