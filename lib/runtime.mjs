import { performD1 } from './d1.mjs';
import { encodeHeaders } from './header-wire.mjs';
import { readBounded } from './body.mjs';
import { performQueue } from './queue.mjs';
import { performRateLimit } from './rate-limit.mjs';
import { performAnalytics } from './analytics.mjs';
import { performVersionMetadata, performSecretsStore } from './metadata.mjs';
import { performWorkerLoader } from './worker-loader.mjs';
import { performDigest } from './subtle-crypto.mjs';
import { performHttp } from './http-client.mjs';
import { performPipeline } from './pipeline.mjs';
import { performSleep } from './timer.mjs';
import { performWorkflow } from './workflow.mjs';
import { performImageInfo } from './images.mjs';
import { performRpc } from './rpc.mjs';
import { performAi } from './ai.mjs';
import { performServiceTcp } from './service-tcp.mjs';
import { performVectorize } from './vectorize.mjs';
import { performDispatch } from './dispatch.mjs';
import { performMediaFrame } from './media.mjs';
import { performAiSearch } from './ai-search.mjs';
import { performDurableStorage } from './durable-storage.mjs';
import { performR2 } from './r2.mjs';
import { performCache } from './cache.mjs';
import { performService } from './service.mjs';

// JS half of the libcf C ABI. The caller supplies Emscripten's factory and a
// statically imported CompiledWasm module; no global mutable request context.
export function createWorker(createCppWorker, compiledWasm, { fetchBinding = 'ASSETS' } = {}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const active = new Map();
  const streamControllers = new Map();
  const maxBody = 1024 * 1024;
  let nextId = 0;
  let workerPromise;
  let cppInstance;

  function rejectInvocation(id, error) {
    const call = active.get(id);
    if (!call) return;
    active.delete(id);
    // Settle the owning fetch first. Its finally block performs native cleanup;
    // a trap must not escape this detached host-completion promise.
    call.reject?.(error);
  }

  function encodeFields(fields) {
    const bytes = fields.map(value => typeof value === 'string' ? encoder.encode(value) : value);
    const size = bytes.reduce((total, field) => total + 4 + field.length, 0);
    if (size > 4 * 1024 * 1024) throw new RangeError('host result exceeds 4 MiB');
    const output = new Uint8Array(size);
    const view = new DataView(output.buffer);
    let offset = 0;
    for (const field of bytes) {
      view.setUint32(offset, field.length, true);
      offset += 4;
      output.set(field, offset);
      offset += field.length;
    }
    return output;
  }

  function encodeKvList(result) {
    const fields = [result.list_complete ? '' : result.cursor, ...result.keys.flatMap(key => [
      key.name,
      key.expiration == null ? '' : String(key.expiration),
      key.metadata == null ? '' : JSON.stringify(key.metadata),
    ])];
    const data = encodeFields(fields);
    const output = new Uint8Array(data.length + 8);
    const view = new DataView(output.buffer);
    view.setUint32(0, result.keys.length, true);
    view.setUint32(4, result.list_complete ? 1 : 0, true);
    output.set(data, 8);
    return output;
  }

  async function performOperation(method, binding, key, body, options) {
    const present = bytes => ({ status: 0, bytes });
    const missing = { status: 1, bytes: new Uint8Array() };
    switch (method) {
      case 288:
        if (key || options) throw new TypeError('image info has no key or options');
        return performImageInfo(binding, body);
      case 272:
      case 273:
      case 274:
      case 275:
        return performWorkflow(method, binding, key, body, options);
      case 240:
        return performPipeline(binding, body);
      case 192:
        return performWorkerLoader(binding, key, body, options, { encodeFields, encodeHeaders, readBounded });
      case 160:
        return performVersionMetadata(binding);
      case 176:
        return performSecretsStore(binding);
      case 144:
        return performAnalytics(binding, body);
      case 128:
        return performRateLimit(binding, key);
      case 112:
      case 113:
        return performQueue(method, binding, body, options);
      case 80:
      case 81:
      case 82:
        return performDurableStorage(method, binding, key, body);
      case 96:
        if (!options) throw new TypeError('Durable Object name must not be empty');
        return performService(binding.getByName(options), key, body, { encodeFields, encodeHeaders, readBounded });
      case 64:
        return performService(binding, key, body, { encodeFields, encodeHeaders, readBounded });
      case 32:
      case 33:
      case 34:
      case 35:
      case 36:
        return performR2(method, binding, key, body, options, { encodeFields, readBounded });
      case 16:
      case 17:
      case 18:
      case 19:
      case 20:
        return performD1(method, binding, key, body);
      case 1: { // KvGetText
        const ttl = options ? Number(options) : undefined;
        const value = await binding.get(key, ttl === undefined ? 'text' : { type: 'text', cacheTtl: ttl });
        if (value === null) return missing;
        const bytes = encoder.encode(value);
        if (bytes.length > maxBody) throw new RangeError('KV value exceeds 1 MiB bridge limit');
        return present(bytes);
      }
      case 2: { // KvPut: decimal TTL, decimal expiration, then independent JSON
        const first = options.indexOf('\n');
        const second = options.indexOf('\n', first + 1);
        if (first < 0 || second < 0) throw new TypeError('malformed KV put options');
        const ttl = options.slice(0, first);
        const expiration = options.slice(first + 1, second);
        const metadata = options.slice(second + 1);
        const parseInteger = text => {
          if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
            throw new TypeError('invalid KV expiration integer');
          return Number(text);
        };
        const parsed = {
          ...(ttl ? { expirationTtl: parseInteger(ttl) } : {}),
          ...(expiration ? { expiration: parseInteger(expiration) } : {}),
          ...(metadata ? { metadata: JSON.parse(metadata) } : {}),
        };
        await binding.put(key, body, parsed);
        return present(new Uint8Array());
      }
      case 3: // KvDelete
        await binding.delete(key);
        return present(new Uint8Array());
      case 4: { // KvList
        const limit = Number(decoder.decode(body));
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('invalid KV list limit');
        const page = await binding.list({
          limit, ...(key ? { prefix: key } : {}), ...(options ? { cursor: options } : {}),
        });
        return present(encodeKvList(page));
      }
      case 5: { // KvGetBytes
        const value = await binding.get(key, 'arrayBuffer');
        if (value === null) return missing;
        if (value.byteLength > maxBody) throw new RangeError('KV value exceeds 1 MiB bridge limit');
        return present(new Uint8Array(value));
      }
      case 6: { // KvGetMetadata
        const result = await binding.getWithMetadata(key, 'arrayBuffer');
        if (result.value === null) return missing;
        if (result.value.byteLength > maxBody) throw new RangeError('KV value exceeds 1 MiB bridge limit');
        return present(encodeFields([
          new Uint8Array(result.value),
          result.metadata == null ? '' : JSON.stringify(result.metadata),
        ]));
      }
      default:
        throw new RangeError('unknown libcf storage operation');
    }
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
          heap.set(bytes, outputPtr);
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
          const nullBody = [204, 205, 304].includes(status);
          if (nullBody && bytes.length) throw new TypeError('null-body response status has body bytes');
          call.response = new Response(nullBody ? null : bytes, { status, headers: call.headers });
          call.resolve?.(call.response);
        },
        streamBegin(id, status) {
          const call = active.get(id);
          if (!call) throw new Error('unknown stream invocation');
          call.response = new Response(new ReadableStream({
            pull(controller) {
              streamControllers.set(id, controller);
              try {
                cppInstance._libcf_stream_pull(id);
              } catch (error) {
                cppInstance._libcf_stream_cancel(id);
                streamControllers.delete(id);
                controller.error(error);
              }
            },
            cancel() {
              cppInstance._libcf_stream_cancel(id);
              streamControllers.delete(id);
            },
          }), { status, headers: call.headers });
          call.streaming = true;
          call.resolve?.(call.response);
        },
        streamEmit(id, bytes, done) {
          const controller = streamControllers.get(id);
          if (!controller) throw new Error('stream has no active pull');
          if (done) {
            streamControllers.delete(id);
            controller.close();
          } else {
            controller.enqueue(bytes);
          }
        },
        background(id, kind, targetBytes, keyBytes, valueBytes) {
          const call = active.get(id);
          if (!call) throw new Error('unknown invocation');
          const target = decoder.decode(targetBytes);
          let task;
          if (kind === 0) {
            const binding = call.env[target];
            if (typeof binding?.put !== 'function') throw new Error('KV binding missing');
            task = binding.put(decoder.decode(keyBytes), decoder.decode(valueBytes));
          } else if (kind === 1) {
            task = globalThis.fetch(target);
          } else {
            throw new Error('unsupported background operation');
          }
          call.ctx.waitUntil(task);
        },
        operation(operation, invocation, method, bindingBytes, keyBytes, body, optionsBytes) {
          const call = active.get(invocation);
          if (!call) return;
          const bindingName = decoder.decode(bindingBytes);
          const key = decoder.decode(keyBytes);
          const options = decoder.decode(optionsBytes);
          Promise.resolve()
            .then(() => {
              if (!active.has(invocation) || call.signal.aborted) throw new Error('request cancelled before operation dispatch');
              if (method === 256) {
                if (bindingName || key || options) throw new TypeError('sleep has no binding, key or options');
                return performSleep(body, call.signal);
              }
              if (method === 224) {
                if (bindingName) throw new TypeError('HTTP fetch has no resource binding');
                return performHttp(key, body, options, { encodeFields, encodeHeaders, readBounded }, call.signal, fetch);
              }
              if (method === 208) {
                if (bindingName || options) throw new TypeError('digest has no binding or options');
                return performDigest(key, body, crypto.subtle);
              }
              if (method >= 48 && method <= 50)
                return performCache(method, bindingName, key, body, { encodeFields, encodeHeaders, readBounded });
              const binding = call.env[bindingName];
              if (!binding) throw new Error('storage binding missing');
              if (method === 304) return performRpc(method, binding, key, body, options, call.signal);
              if (method === 320) return performAi(binding, key, body, options, call.signal);
              if (method === 336) return performServiceTcp(binding, key, body, options, call.signal);
              if (method === 400) return performAiSearch(binding, key, body, options, call.signal);
              if (method === 384) return performMediaFrame(binding, key, body, options, call.signal);
              if (method === 352) return performVectorize(binding, key, body, options, call.signal);
              if (method === 368) return performDispatch(binding, key, body, options, { encodeFields, encodeHeaders, readBounded }, call.signal);
              return performOperation(method, binding, key, body, options);
            })
            .then(({ status, bytes }) => {
              if (active.has(invocation)) borrow(cppInstance, bytes,
                (ptr, length) => cppInstance._libcf_operation_done(operation, status, ptr, length));
            }, error => {
              if (active.has(invocation)) {
                const message = encoder.encode(String(error?.message ?? 'binding failed').slice(0, 2048));
                borrow(cppInstance, message,
                  (ptr, length) => cppInstance._libcf_operation_done(operation, 2, ptr, length));
              }
            })
            .catch(error => rejectInvocation(invocation, error));
        },
        fetch(operation, invocation, pathBytes) {
          const call = active.get(invocation);
          if (!call) return;
          const path = decoder.decode(pathBytes);
          Promise.resolve()
            .then(() => {
              if (!active.has(invocation) || call.signal.aborted) throw new Error('request cancelled before fetch dispatch');
              return call.env[fetchBinding].fetch(new Request(`https://libcf.test${path}`, { signal: call.signal }));
            })
            .then(async response => ({ status: response.status, bytes: await readBounded(response.body, maxBody, call.signal) }))
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
            .catch(error => rejectInvocation(invocation, error));
        },
      },
    }).then(instance => (cppInstance = instance), error => {
      workerPromise = undefined;
      throw error;
    });
    return workerPromise;
  }

  function abortedResponse(request) {
    if (request.body && !request.body.locked)
      void request.body.cancel('request aborted').catch(() => {});
    return new Response('request aborted', { status: 408 });
  }

  return {
    async fetch(request, env, ctx) {
      if (request.signal.aborted) return abortedResponse(request);
      let cpp;
      try { cpp = await getWorker(); }
      catch (error) {
        if (request.signal.aborted) return abortedResponse(request);
        throw error;
      }
      if (request.signal.aborted) return abortedResponse(request);
      let body;
      let headers;
      try {
        // Parse limits before running C++ or side-effecting a binding.
        if (Number(request.headers.get('content-length')) > maxBody) throw new RangeError('body too large');
        body = await readBounded(request.body, maxBody, request.signal);
        headers = encodeHeaders(request.headers);
      } catch (error) {
        if (request.signal.aborted) return abortedResponse(request);
        if (error instanceof RangeError) {
          const status = error.message.includes('headers') ? 431 : 413;
          return new Response(error.message, { status });
        }
        throw error;
      }
      if (request.signal.aborted) return abortedResponse(request);
      // The C ABI takes a signed wasm32 int, not a JS safe integer.
      if (nextId === 0x7fffffff) throw new Error('invocation ID space exhausted');
      const id = ++nextId;
      const foreground = new AbortController();
      const call = { env, ctx, signal: foreground.signal, headers: new Headers(), response: null };
      active.set(id, call);
      const aborted = () => {
        active.delete(id);
        foreground.abort(request.signal.reason);
        try {
          cpp._libcf_cancel(id);
          call.resolve?.(new Response('request aborted', { status: 408 }));
        } catch (error) {
          call.reject?.(error);
        }
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
        active.delete(id);
        // Foreground IO must not outlive the invocation, even on normal return
        // or a C++ cleanup trap. Registered waitUntil tasks have separate ownership.
        foreground.abort(new DOMException('invocation finished', 'AbortError'));
        if (!call.streaming || !call.response) cpp._libcf_cancel(id);
      }
    },
  };
}
