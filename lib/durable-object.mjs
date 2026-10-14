import { DurableObject } from 'cloudflare:workers';
import { createWorker } from './runtime.mjs';
import { upgradeSocket, socketMessage, applySocketResponse } from './websocket.mjs';

// Each object owns its own Wasm instance and invocation maps. Never share an
// application instance between objects or run constructor setup as fetch I/O.
export function createDurableObject(factory, wasm) {
  return class extends DurableObject {
    #application;
    constructor(ctx, env) {
      super(ctx, env);
      if ('__LIBCF_DO_EVENT' in env || '__LIBCF_DO_STORAGE' in env || '__LIBCF_DO_CONTAINER' in env || Object.keys(env).some(key => key.startsWith('__LIBCF_WS_')))
        throw new Error('reserved libcf Durable Object bindings conflict');
      this.#application = createWorker(factory, wasm);
      ctx.blockConcurrencyWhile(async () => {
        const response = await this.#invoke('initialize', new Request('https://libcf.internal/initialize'));
        if (!response.ok) throw new Error('C++ Durable Object initialization failed');
        await response.arrayBuffer();
      });
    }
    #invoke(event, request, metadata = {}) {
      return this.#application.fetch(request, {
        ...this.env, ...metadata, __LIBCF_DO_STORAGE: this.ctx.storage, __LIBCF_DO_CONTAINER: this.ctx.container, __LIBCF_DO_EVENT: event,
      }, this.ctx);
    }
    async fetch(request) {
      return upgradeSocket(request, await this.#invoke('fetch', request), this.ctx);
    }
    async webSocketMessage(socket, message) {
      let frame;
      try { frame = socketMessage(message); }
      catch (error) { socket.close(1009, 'unsupported frame size or type'); throw error; }
      try {
        const response = await this.#invoke('websocket', new Request('https://libcf.internal/websocket', {
          method: 'POST', body: frame.body,
        }), frame.metadata);
        await applySocketResponse(socket, response);
      } catch (error) {
        socket.close(1011, 'WebSocket handler failed');
        throw error;
      }
    }
    async webSocketClose(socket, code, reason, wasClean) {
      try {
        const response = await this.#invoke('websocket', new Request('https://libcf.internal/websocket', {
          method: 'POST', body: reason,
        }), { __LIBCF_WS_KIND: 'close', __LIBCF_WS_CODE: String(code), __LIBCF_WS_CLEAN: wasClean ? '1' : '0' });
        await applySocketResponse(socket, response, false);
      }
      finally {
        // Harmless when auto-reply already closed the socket; also completes
        // the handshake on runtimes/proxies that still require a reply.
        socket.close(code === 1005 || code === 1006 || code === 1015 ? 1000 : code, reason);
      }
    }
    async webSocketError(socket) {
      try {
        const response = await this.#invoke('websocket', new Request('https://libcf.internal/websocket'), {
          __LIBCF_WS_KIND: 'error',
        });
        await applySocketResponse(socket, response, false);
      } finally { socket.close(1011, 'WebSocket transport error'); }
    }
    async alarm() {
      const response = await this.#invoke('alarm', new Request('https://libcf.internal/alarm'));
      if (!response.ok) throw new Error('C++ Durable Object alarm failed');
      await response.arrayBuffer();
    }
  };
}
