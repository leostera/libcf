import { WorkflowEntrypoint } from 'cloudflare:workers';
import factory from '../../build/workflow.mjs';
import wasm from '../../build/workflow.wasm';
import { createWorker } from '../../lib/runtime.mjs';
const cpp = createWorker(factory, wasm);
export class FixtureWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    if (event.payload.wait) {
      const received = await step.waitForEvent('gate', { type: 'continue', timeout: '1 minute' });
      return step.do('echo', () => ({ initial: event.payload, received: received.payload }));
    }
    return step.do('echo', () => event.payload);
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Local reference-side readback proves params reached the JS workflow.
    // This is not a C++ output/replay API and is not production authorization.
    if (url.pathname === '/fixture-output') {
      const instance = await env.FLOW.get(url.searchParams.get('id'));
      return Response.json((await instance.status()).output ?? null);
    }
    return cpp.fetch(request, env, ctx);
  },
};
