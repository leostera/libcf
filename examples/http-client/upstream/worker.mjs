import { readBounded } from '../../../lib/body.mjs';

// Diagnostic-only upstream: no storage, credentials or external fetches.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/redirect') return new Response(null, { status: 302, headers: { location: '/echo' } });
    if (url.pathname === '/empty') return new Response(null, { status: 204 });
    if (url.pathname === '/large') return new Response(new Uint8Array(1048577));
    // A real HTTP error response, not a fabricated connection failure.
    if (url.pathname === '/failure') return new Response('fixture upstream unavailable', { status: 503 });
    if (url.pathname !== '/echo') return new Response('not found', { status: 404 });
    let body;
    try { body = await readBounded(request.body, 1048576, request.signal); }
    catch { return new Response('invalid request body', { status: 413 }); }
    return new Response(body, { status: 201, headers: {
      'content-type': 'application/octet-stream', 'x-upstream-method': request.method,
      'x-upstream-host': url.host, 'x-client': request.headers.get('x-client') ?? '',
      'x-has-authorization': String(request.headers.has('authorization')),
      'x-has-cookie': String(request.headers.has('cookie')),
    } });
  },
};
