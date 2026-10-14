export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/redirect') return new Response('redirect fixture', { status: 302, headers: { location: 'https://not-contacted.invalid/' } });
    if (path === '/max-reply') return new Response(new Uint8Array(1048576));
    if (path === '/overflow') return new Response(new Uint8Array(1048577));
    if (path !== '/echo') return new Response('not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : await request.arrayBuffer(), {
      status: 201,
      headers: { 'content-type': 'application/octet-stream', 'x-input': request.headers.get('x-input') ?? '', 'x-method': request.method },
    });
  },
};
