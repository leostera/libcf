import factory from '../../build/images.mjs';
import wasm from '../../build/images.wasm';
import { createWorker } from '../../lib/runtime.mjs';
const worker = createWorker(factory, wasm);
export default {
  ...worker,
  fetch(request, env, ctx) {
    // Existing metadata live probes must not accidentally expose a billable
    // transform endpoint. Only the isolated local fixture enables these routes.
    if (new URL(request.url).pathname.startsWith('/rotate') && env.LIBCF_IMAGES_LOCAL_ROTATION !== 'enabled')
      return new Response('rotation disabled', { status: 403 });
    return worker.fetch(request, env, ctx);
  },
};
