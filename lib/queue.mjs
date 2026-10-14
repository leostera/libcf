const decoder = new TextDecoder('utf-8', { fatal: true });
export async function performQueue(method, queue, body, options) {
  // Decimal KB per the platform limits; this is not a provider acceptance guarantee.
  if (body.length >= 128_000 || !/^\d+$/.test(options)) throw new RangeError('invalid Queue payload or delay');
  const delaySeconds = Number(options);
  if (!Number.isSafeInteger(delaySeconds) || delaySeconds > 86400) throw new RangeError('invalid Queue delay');
  if (method === 112) await queue.send(decoder.decode(body), { contentType: 'text', delaySeconds });
  else if (method === 113) await queue.send(body.slice(), { contentType: 'bytes', delaySeconds });
  else throw new TypeError('unknown Queue operation');
  return { status: 0, bytes: new Uint8Array() };
}
