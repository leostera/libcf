import factory from '../../build/clock.mjs';
import wasm from '../../build/clock.wasm';
import { createWorker } from '../../lib/runtime.mjs';
const cpp = createWorker(factory, wasm);
export default {
  async fetch(request, env, ctx) {
    const before = Date.now();
    const response = await cpp.fetch(request, env, ctx);
    // Awaiting C++ completion can cross an I/O turn; bracket rather than
    // assuming a later JS sample must equal the C++ sample exactly.
    response.headers.set('x-js-clock-before', String(before));
    response.headers.set('x-js-clock-after', String(Date.now()));
    return response;
  },
};
