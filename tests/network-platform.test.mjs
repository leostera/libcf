import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';

// JS-only feasibility checks, not a C++ socket API or live networking claim.
const worker = (name, contents, env = {}) => ({ config: {
  name, compatibilityDate: '2026-10-13', env, exports: {},
  manifest: { mainModule: 'worker.mjs', modulesRoot: `/libcf-network/${name}`,
    modules: { 'worker.mjs': { type: 'esm', contents } } },
} });

test('pinned workerd service bindings forward real binary streams to a connect handler', { timeout: 15000 }, async () => {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    worker('client', `
      export default { async fetch(request, env) {
        // This address is passed to the bound Worker, never resolved externally.
        const socket = env.BACKEND.connect('socket-fixture.invalid:1234', { allowHalfOpen: true });
        socket.closed.catch(() => {});
        const deadline = setTimeout(() => { socket.close().catch(() => {}); }, 3000);
        try {
          await socket.opened;
          const write = async () => {
            const writer = socket.writable.getWriter();
            try {
              await writer.write(new Uint8Array([0, 1, 127, 128, 255]));
              await writer.close();
            } finally { writer.releaseLock(); }
          };
          const read = async () => {
            const reader = socket.readable.getReader();
            const output = [];
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (output.length + value.length > 32) throw new Error('fixture overflow');
                output.push(...value);
              }
            } finally { reader.releaseLock(); }
            return output;
          };
          // Duplex backpressure requires reading while the peer consumes writes.
          const [output] = await Promise.all([read(), write()]);
          return Response.json(output);
        } finally { clearTimeout(deadline); socket.close().catch(() => {}); }
      } };
    `, { BACKEND: { type: 'worker', worker: 'backend' } }),
    worker('backend', `
      export default {
        async connect(socket) { await socket.readable.pipeTo(socket.writable); },
        fetch() { return new Response('not an HTTP echo', { status: 404 }); },
      };
    `),
  ] });
  try {
    const response = await mf.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [0, 1, 127, 128, 255]);
  } finally { await mf.dispose(); }
});

test('node:dgram import and construction are only stub availability, not UDP capability', { timeout: 15000 }, async () => {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [worker('udp-stub', `
    import { createSocket } from 'node:dgram';
    export default { fetch() {
      const socket = createSocket('udp4');
      // No bind, send or network destination: inspect the pinned stub contract only.
      try { return Response.json({ address: socket.address(), receiveBuffer: socket.getRecvBufferSize() }); }
      finally { socket.close(); }
    } };
  `)] });
  try {
    const response = await mf.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { address: {}, receiveBuffer: 0 });
  } finally { await mf.dispose(); }
});
