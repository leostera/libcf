import worker from '../worker.mjs';

// Test-only object, deliberately not a native/remote AI binding. No network I/O.
const AI = {
  async run(model, input, options) {
    if (this !== AI || options.returnRawResponse !== true || !(options.signal instanceof AbortSignal))
      throw new Error('invalid AI adapter contract');
    options.signal.throwIfAborted();
    if (input.fixture === 'error') return new Response('provider failure', { status: 429 });
    if (input.fixture === 'binary') return new Response(new Uint8Array([1, 2]), {
      headers: { 'content-type': 'application/octet-stream' },
    });
    return Response.json({ model, input, mocked: true });
  },
};
export default {
  fetch(request, env, ctx) { return worker.fetch(request, { ...env, AI }, ctx); },
};
