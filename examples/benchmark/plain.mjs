import { readBounded } from '../../lib/body.mjs';
const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
export default {
  async fetch(request) {
    const input = await readBounded(request.body);
    const path = new URL(request.url).pathname;
    if (path === '/hello') return text('ok');
    if (path === '/echo') return text(input);
    if (path !== '/digest/1' && path !== '/digest/16') return text('not found', 404);
    const iterations = path === '/digest/16' ? 16 : 1;
    let digest;
    for (let index = 0; index < iterations; index++) digest = await crypto.subtle.digest('SHA-256', input);
    return text(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
  },
};
