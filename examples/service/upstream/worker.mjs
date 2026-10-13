export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/empty') return new Response(null, { status: 204 });
    if (path === '/fail') return new Response('upstream unavailable', { status: 503 });
    return new Response(await request.arrayBuffer(), {
      status: 201,
      headers: {
        'x-caller': request.headers.get('x-cf-caller') ?? 'absent',
        'x-method': request.method,
        'x-forwarded': request.headers.get('x-original') ?? 'absent',
      },
    });
  },
};
