import { readBounded } from './body.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const outputLimit = 1048576;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

function parseScreenshot(key, body, options) {
  if (key !== '' || !(body instanceof Uint8Array) || !body.byteLength || body.byteLength > 65536 ||
      typeof options !== 'string' || /^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}:[1-9][0-9]{0,4}$/.exec(options)?.[0] !== options)
    throw new TypeError('invalid Browser screenshot request');
  const [width, height, timeout] = options.split(':').map(Number);
  if (width > 512 || height > 512 || timeout > 60000) throw new RangeError('invalid Browser screenshot limits');
  // Decode before suspension; no view into the caller's Wasm memory escapes.
  return { html: decoder.decode(body), width, height, timeout };
}

function discardResponse(response) {
  if (!(response instanceof Response)) return;
  try {
    const body = response.body;
    if (body && !body.locked) void Promise.resolve(body.cancel()).catch(() => {});
  } catch {}
  try { response.webSocket?.close(1000, 'Browser response discarded'); } catch {}
}

async function readScreenshot(response, signal) {
  let body;
  try {
    const contentType = response instanceof Response ? response.headers.get('content-type') : undefined;
    if (!(response instanceof Response) || response.status !== 200 || response.webSocket ||
        typeof contentType !== 'string' || contentType.length > 128 ||
        contentType.split(';', 1)[0].trim().toLowerCase() !== 'image/png')
      throw new TypeError('invalid Browser screenshot response');
    body = response.body;
    if (!body) throw new TypeError('invalid Browser screenshot response');
  } catch (error) { discardResponse(response); throw error; }
  // Snapshot once: the bounded reader now owns cancellation, including overflow/abort.
  const bytes = await readBounded(body, outputLimit, signal);
  if (bytes.length < pngSignature.length || !pngSignature.every((value, i) => bytes[i] === value))
    throw new TypeError('invalid Browser PNG signature');
  // MIME/signature checks are not full PNG decoding or dimension verification.
  return { status: 0, bytes };
}

export async function performBrowserScreenshot(binding, key, body, options, signal) {
  const { html, width, height, timeout } = parseScreenshot(key, body, options);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid Browser signal');
  signal?.throwIfAborted();
  const invoke = binding?.quickAction;
  if (typeof invoke !== 'function') throw new TypeError('Browser binding unavailable');
  const controller = new AbortController();
  let pending, accepting = true, succeeded = false, cleanupFailed = false, cleanupError, rejectOnAbort;
  const disposed = new WeakSet();
  const dispose = value => {
    if (value === binding || value === null || !['object', 'function'].includes(typeof value) || disposed.has(value)) return;
    disposed.add(value);
    try {
      const release = value[Symbol.dispose];
      if (release !== undefined && typeof release !== 'function') throw new TypeError('invalid Browser disposer');
      if (release) Reflect.apply(release, value, []);
    } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
  };
  const abort = () => { dispose(pending); rejectOnAbort(); };
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new DOMException('Browser deadline exceeded', 'TimeoutError')), timeout);
  try {
    const canceled = new Promise((_, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const observed = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      pending = Reflect.apply(invoke, binding, ['screenshot', {
        html, viewport: { width, height, deviceScaleFactor: 1 },
        screenshotOptions: { type: 'png', encoding: 'binary', fullPage: false, captureBeyondViewport: false },
        setJavaScriptEnabled: false, rejectRequestPattern: ['.*'], cacheTTL: 0, bestAttempt: false,
        gotoOptions: { timeout, waitUntil: 'domcontentloaded' }, actionTimeout: timeout,
      }]);
      if (controller.signal.aborted) dispose(pending);
      return pending;
    }).then(async response => {
      try {
        if (!accepting || controller.signal.aborted) {
          discardResponse(response);
          throw controller.signal.reason ?? new Error('Browser request ended');
        }
        return await readScreenshot(response, controller.signal);
      } finally { dispose(response); }
    });
    // No native AbortSignal parameter exists here. These options are not a proven
    // isolation boundary; local cancellation cannot promise stopped work/billing.
    const result = await Promise.race([observed, canceled]);
    controller.signal.throwIfAborted();
    succeeded = true;
    return result;
  } finally {
    accepting = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', abort);
    dispose(pending);
    if (succeeded && cleanupFailed) throw cleanupError;
  }
}
