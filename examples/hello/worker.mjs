import createCppWorker from '../../build/spike.mjs';
import compiledWasm from '../../build/spike.wasm';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const pending = new Map();
let nextId = 0;
let workerPromise;
let cpp;

function requestId() {
  if (nextId >= 0x7fffffff) throw new Error('request ID space exhausted');
  return ++nextId;
}

function withBytes(bytes, invoke) {
  const ptr = cpp._malloc(Math.max(1, bytes.length));
  if (!ptr) throw new Error('out of Wasm memory');
  try {
    cpp.HEAPU8.set(bytes, ptr);
    return invoke(ptr, bytes.length);
  } finally {
    cpp._free(ptr);
  }
}

function resume(id, value, status) {
  // The exported function borrows the bytes until it returns. Never hold a
  // view into Wasm memory across an await or a memory-growth allocation.
  withBytes(encoder.encode(value), (ptr, length) => cpp._cf_resume(id, ptr, length, status));
}

function getWorker() {
  workerPromise ??= createCppWorker({
    instantiateWasm(imports, receiveInstance) {
      // A static CompiledWasm import avoids fetch/import.meta URL resolution.
      const instance = new WebAssembly.Instance(compiledWasm, imports);
      receiveInstance(instance);
      return instance.exports;
    },
    cfHost: {
      get(id, keyBytes) {
        const call = pending.get(id);
        if (!call) throw new Error('unknown or completed request');
        const key = decoder.decode(keyBytes);
        Promise.resolve().then(() => call.env.STATE_KV.get(key)).then(
          value => resume(id, value ?? '', value === null ? 404 : 200),
          () => resume(id, '', 502),
        );
      },
      fetch(id, pathBytes) {
        const call = pending.get(id);
        if (!call) throw new Error('unknown or completed request');
        const path = decoder.decode(pathBytes);
        Promise.resolve()
          .then(() => call.env.ASSETS.fetch(new Request(`https://libcf.test${path}`)))
          .then(async response => ({ value: await response.text(), status: response.status }))
          .then(({ value, status }) => resume(id, value, status), () => resume(id, '', 502));
      },
      background(id, keyBytes, valueBytes) {
        const call = pending.get(id);
        if (!call) throw new Error('unknown request');
        const key = decoder.decode(keyBytes);
        const value = decoder.decode(valueBytes);
        call.ctx.waitUntil(call.env.STATE_KV.put(key, value));
      },
      emit(id, bytes, status) {
        const call = pending.get(id);
        if (!call) throw new Error('unknown or cancelled request');
        if (call.controller) {
          call.controller.enqueue(bytes);
        } else {
          pending.delete(id);
          call.resolve(new Response(bytes, { status }));
        }
      },
    },
  }).then(instance => (cpp = instance), error => {
    workerPromise = undefined;
    throw error;
  });
  return workerPromise;
}

export default {
  async fetch(request, env, ctx) {
    await getWorker();
    const url = new URL(request.url);
    if (url.pathname === '/get') {
      const id = requestId();
      const result = new Promise((resolve, reject) => pending.set(id, { env, ctx, resolve, reject }));
      try {
        withBytes(encoder.encode(url.searchParams.get('key') ?? ''),
          (ptr, length) => cpp._cf_get(id, ptr, length));
      } catch (error) {
        pending.delete(id);
        throw error;
      }
      return result;
    }
    if (url.pathname === '/asset') {
      const id = requestId();
      const result = new Promise(resolve => pending.set(id, { env, ctx, resolve }));
      try {
        withBytes(encoder.encode('/hello.txt'),
          (ptr, length) => cpp._cf_fetch_asset(id, ptr, length));
      } catch (error) {
        pending.delete(id);
        throw error;
      }
      return result;
    }
    if (url.pathname === '/write') {
      const id = requestId();
      pending.set(id, { env, ctx });
      try {
        const key = encoder.encode(url.searchParams.get('key') ?? '');
        const value = encoder.encode(url.searchParams.get('value') ?? '');
        withBytes(key, (keyPtr, keyLength) => withBytes(value, (valuePtr, valueLength) =>
          cpp._cf_background_write(id, keyPtr, keyLength, valuePtr, valueLength)));
      } finally {
        pending.delete(id);
      }
      return new Response('queued', { status: 202 });
    }
    if (url.pathname === '/stream') {
      const count = Number(url.searchParams.get('count') ?? 3);
      if (!Number.isInteger(count) || count < 0 || count > 128) return new Response('invalid count', { status: 400 });
      const id = requestId();
      let next = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (next === count) {
            pending.delete(id);
            controller.close();
            return;
          }
          pending.set(id, { controller });
          cpp._cf_stream_chunk(id, next++);
        },
        cancel() { pending.delete(id); },
      }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const a = Number(url.searchParams.get('a') ?? 1);
    const b = Number(url.searchParams.get('b') ?? 2);
    return new Response(`${env.GREETING}: ${cpp._cf_add(a, b)}`);
  },
};
