import createCppWorker from '../../build/core.mjs';
import compiledWasm from '../../build/core.wasm';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const active = new Map();
const maxBody = 1024 * 1024;
let nextId = 0;
let workerPromise;
let cppInstance;

function encodeHeaders(headers) {
  const fields = [...headers].map(([name, value]) => [encoder.encode(name), encoder.encode(value)]);
  const length = fields.reduce((total, [name, value]) => total + 8 + name.length + value.length, 0);
  if (length > 65536) throw new RangeError('request headers exceed 64 KiB');
  const buffer = new Uint8Array(length);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  for (const [name, value] of fields) {
    view.setUint32(offset, name.length, true);
    view.setUint32(offset + 4, value.length, true);
    offset += 8;
    buffer.set(name, offset);
    offset += name.length;
    buffer.set(value, offset);
    offset += value.length;
  }
  return buffer;
}

async function readBounded(body) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBody) {
      await reader.cancel();
      throw new RangeError('request body exceeds 1 MiB');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function borrow(cpp, bytes, callback) {
  const ptr = cpp._malloc(Math.max(bytes.length, 1));
  if (!ptr) throw new Error('Wasm allocation failed');
  try {
    cpp.HEAPU8.set(bytes, ptr);
    return callback(ptr, bytes.length);
  } finally {
    cpp._free(ptr);
  }
}

function getWorker() {
  workerPromise ??= createCppWorker({
    instantiateWasm(imports, receiveInstance) {
      const instance = new WebAssembly.Instance(compiledWasm, imports);
      receiveInstance(instance);
      return instance.exports;
    },
    libcfHost: {
      var(id, nameBytes, outputPtr, capacity, heap) {
        const call = active.get(id);
        if (!call) throw new Error('unknown invocation');
        const value = call.env[decoder.decode(nameBytes)];
        if (typeof value !== 'string') return -1;
        const bytes = encoder.encode(value);
        if (capacity === 0) return bytes.length;
        if (capacity < bytes.length) return -2;
        if (capacity) heap.set(bytes, outputPtr);
        return bytes.length;
      },
      header(id, nameBytes, valueBytes) {
        const call = active.get(id);
        if (!call) throw new Error('unknown invocation');
        call.headers.append(decoder.decode(nameBytes), decoder.decode(valueBytes));
      },
      finish(id, status, bytes) {
        const call = active.get(id);
        if (!call) return; // already cancelled
        call.response = new Response(bytes, { status, headers: call.headers });
        call.resolve?.(call.response);
      },
      fetch(operation, invocation, pathBytes) {
        const call = active.get(invocation);
        if (!call) return;
        const path = decoder.decode(pathBytes);
        Promise.resolve()
          .then(() => call.env.ASSETS.fetch(new Request(`https://libcf.test${path}`)))
          .then(async response => ({ status: response.status, bytes: await readBounded(response.body) }))
          .then(
            ({ status, bytes }) => {
              if (active.has(invocation)) borrow(cppInstance, bytes,
                (ptr, length) => cppInstance._libcf_fetch_done(operation, status, ptr, length));
            },
            () => {
              if (active.has(invocation)) borrow(cppInstance, new Uint8Array(),
                (ptr, length) => cppInstance._libcf_fetch_done(operation, 0, ptr, length));
            },
          )
          .catch(error => {
            // A glue/ABI exception must not leave a coroutine or JS Promise
            // pending forever. Preserve the error for the caller, not logs.
            if (active.has(invocation)) {
              cppInstance._libcf_cancel(invocation);
              active.delete(invocation);
              call.reject?.(error);
            }
          });
      },
    },
  }).then(instance => (cppInstance = instance), error => {
    workerPromise = undefined;
    throw error;
  });
  return workerPromise;
}

export default {
  async fetch(request, env) {
    const cpp = await getWorker();
    let body;
    let headers;
    try {
      // Both HTTP limits are enforced before crossing the ABI or running C++.
      if (Number(request.headers.get('content-length')) > maxBody) throw new RangeError('body too large');
      body = await readBounded(request.body);
      headers = encodeHeaders(request.headers);
    } catch (error) {
      if (error instanceof RangeError) return new Response(error.message, { status: 413 });
      throw error;
    }
    const id = ++nextId;
    if (!Number.isSafeInteger(id)) throw new Error('invocation ID space exhausted');
    const call = { env, headers: new Headers(), response: null };
    active.set(id, call);
    const aborted = () => {
      cpp._libcf_cancel(id);
      active.delete(id);
      call.resolve?.(new Response('request aborted', { status: 408 }));
    };
    request.signal.addEventListener('abort', aborted, { once: true });
    try {
      const completion = new Promise((resolve, reject) => {
        call.resolve = resolve;
        call.reject = reject;
      });
      borrow(cpp, encoder.encode(request.method), (method, methodLength) =>
        borrow(cpp, encoder.encode(request.url), (url, urlLength) =>
          borrow(cpp, headers, (headerPtr, headerLength) =>
            borrow(cpp, body, (bodyPtr, bodyLength) =>
              cpp._libcf_http(id, method, methodLength, url, urlLength,
                headerPtr, headerLength, bodyPtr, bodyLength)))));
      return await completion;
    } finally {
      request.signal.removeEventListener('abort', aborted);
      cpp._libcf_cancel(id);
      active.delete(id);
    }
  },
};
