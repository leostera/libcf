import { readBounded } from '../lib/body.mjs';
import { image, parseQuery, search, validImage, validSearch } from './kernels.mjs';
const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
// Reads a Content-Length body in one native allocation, like the libcf runtime;
// other bodies use the bounded stream reader.
async function readBody(request) {
  const declared = request.headers.get('content-length');
  if (!request.body || declared === null || !/^(0|[1-9][0-9]{0,6})$/.test(declared) || Number(declared) > 1048576)
    return readBounded(request.body);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== Number(declared)) throw new TypeError('body length differs from Content-Length');
  return bytes;
}
const binary = body => new Response(body, { headers: { 'content-type': 'application/octet-stream' } });
export default {
  async fetch(request) {
    const input = await readBody(request);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/hello') return text('ok');
    if (path === '/echo') return text(input);
    if (path === '/image') {
      const params = parseQuery(url.search, ['w', 'h']);
      if (!params || !validImage(params, input.length)) return text('invalid image request', 400);
      return binary(image(input, params.w, params.h));
    }
    if (path === '/search') {
      const params = parseQuery(url.search, ['n', 'd', 'q', 'k']);
      if (!params || !validSearch(params, input.length)) return text('invalid search request', 400);
      return binary(search(input, params.n, params.d, params.q, params.k));
    }
    if (path !== '/digest/1' && path !== '/digest/16') return text('not found', 404);
    const iterations = path === '/digest/16' ? 16 : 1;
    let digest;
    for (let index = 0; index < iterations; index++) digest = await crypto.subtle.digest('SHA-256', input);
    return text(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
  },
};
