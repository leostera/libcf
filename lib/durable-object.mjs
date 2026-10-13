import { DurableObject } from 'cloudflare:workers';
import { createWorker } from './runtime.mjs';

// Each object owns its own Wasm instance and invocation maps. Never share an
// application instance between objects or run constructor setup as fetch I/O.
export function createDurableObject(factory, wasm) {
  return class extends DurableObject {
    #application;
    constructor(ctx, env) {
      super(ctx, env);
      if ('__LIBCF_DO_EVENT' in env || '__LIBCF_DO_STORAGE' in env)
        throw new Error('reserved libcf Durable Object bindings conflict');
      this.#application = createWorker(factory, wasm);
      ctx.blockConcurrencyWhile(async () => {
        const response = await this.#invoke('initialize', new Request('https://libcf.internal/initialize'));
        if (!response.ok) throw new Error('C++ Durable Object initialization failed');
        await response.arrayBuffer();
      });
    }
    #invoke(event, request) {
      return this.#application.fetch(request, {
        ...this.env, __LIBCF_DO_STORAGE: this.ctx.storage, __LIBCF_DO_EVENT: event,
      }, this.ctx);
    }
    fetch(request) { return this.#invoke('fetch', request); }
    async alarm() {
      const response = await this.#invoke('alarm', new Request('https://libcf.internal/alarm'));
      if (!response.ok) throw new Error('C++ Durable Object alarm failed');
      await response.arrayBuffer();
    }
  };
}
