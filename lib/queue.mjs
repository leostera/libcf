const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export async function performQueue(method, queue, body, options) {
  // Decimal KB per the platform limits; this is not a provider acceptance guarantee.
  if (body.length >= 128_000 || !/^\d+$/.test(options)) throw new RangeError('invalid Queue payload or delay');
  const delaySeconds = Number(options);
  if (!Number.isSafeInteger(delaySeconds) || delaySeconds > 86400) throw new RangeError('invalid Queue delay');
  if (method !== 112 && method !== 113) throw new TypeError('unknown Queue operation');
  // Decode/copy before accessing provider code, including a send getter. These
  // are UTF-8 string bytes, not a file whose leading BOM should be removed.
  const payload = method === 112 ? decoder.decode(body) : body.slice();
  const send = queue?.send;
  if (typeof send !== 'function') throw new TypeError('Queue binding missing');
  await Reflect.apply(send, queue, [payload, { contentType: method === 112 ? 'text' : 'bytes', delaySeconds }]);
  return { status: 0, bytes: new Uint8Array() };
}
