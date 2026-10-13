import factory from '../../build/clock.mjs';
import wasm from '../../build/clock.wasm';
import { createWorker } from '../../lib/runtime.mjs';
const cpp = createWorker(factory, wasm);
export default {
  async fetch(request, env, ctx) {
    const response = await cpp.fetch(request, env, ctx);
    // Reference-only readback, not a separate C++ API or precision claim.
    response.headers.set('x-js-clock', String(Date.now()));
    return response;
  },
};
