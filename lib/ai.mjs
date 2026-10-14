import { readBounded } from './body.mjs';
import { encodeBoundedJson, parseBoundedJson } from './json.mjs';

export async function performAi(binding, model, body, options, signal) {
  if (typeof model !== 'string' || /^[A-Za-z0-9@][A-Za-z0-9_./:@-]{0,255}$/.exec(model)?.[0] !== model || options !== '')
    throw new TypeError('invalid AI model or options');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid AI signal');
  const input = parseBoundedJson(body);
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('AI inputs must be a JSON object');
  if (Object.hasOwn(input, 'stream') && input.stream !== false)
    throw new TypeError('AI streaming is not supported by run_json');
  signal?.throwIfAborted();
  const invoke = binding?.run;
  if (typeof invoke !== 'function') throw new TypeError('AI binding unavailable');
  let response;
  try {
    // The default run() parses JSON internally without our byte cap. Request the
    // raw response instead, and let the platform signal cancel its fetch.
    response = await Reflect.apply(invoke, binding, [model, input, { returnRawResponse: true, signal }]);
    signal?.throwIfAborted();
    if (!(response instanceof Response)) throw new TypeError('AI raw response unavailable');
    if (!response.ok) throw new Error(`AI inference failed (HTTP ${response.status})`);
    const mime = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (mime !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(mime))
      throw new TypeError('AI response must be JSON; binary and streaming outputs are unsupported');
    const bytes = await readBounded(response.body, 1048576, signal);
    signal?.throwIfAborted();
    return { status: 0, bytes: encodeBoundedJson(parseBoundedJson(bytes)) };
  } finally {
    // Also release rejected/late responses when a provider ignores abort. Never
    // wait for a producer's cancellation promise or infer remote rollback.
    const stream = response instanceof Response ? response.body : response instanceof ReadableStream ? response : null;
    if (stream && !stream.locked) void stream.cancel('AI JSON operation finished').catch(() => {});
  }
}
