import factory from '../../build/events.mjs';
import wasm from '../../build/events.wasm';
import { createEventWorker } from '../../lib/events.mjs';
const worker = createEventWorker(factory, wasm);
export default {
  ...worker,
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith('/send/batch') && env.LIBCF_EVENTS_LOCAL_BATCH !== 'enabled')
      return new Response('batch producer disabled', {status:403});
    return worker.fetch(request, env, ctx);
  },
};
