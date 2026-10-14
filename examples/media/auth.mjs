// Fail closed before body ingestion or provider invocation. Only the SHA-256 of
// a fresh 256-bit bearer token is deployed; the token itself stays in a local file.
export function authenticatedMediaWorker(worker) {
  return { async fetch(request, env, context) {
    const expected = env.LIBCF_MEDIA_PROBE_SHA256;
    if (typeof expected !== 'string' || /^[a-f0-9]{64}$/.exec(expected)?.[0] !== expected)
      return new Response('Media authentication is not configured', { status: 503 });
    const authorization = request.headers.get('authorization');
    const match = typeof authorization === 'string' && /^Bearer ([a-f0-9]{64})$/.exec(authorization);
    if (!match || match[0] !== authorization) return new Response('unauthorized', { status: 401 });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]));
    const expectedBytes = Uint8Array.from(expected.match(/../g), byte => Number.parseInt(byte, 16));
    if (!crypto.subtle.timingSafeEqual(digest, expectedBytes))
      return new Response('unauthorized', { status: 401 });
    return worker.fetch(request, env, context);
  } };
}
