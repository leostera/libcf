const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function textBatch(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const u32 = () => {
    if (bytes.length - offset < 4) throw new TypeError('truncated Queue batch');
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const count = u32();
  if (count < 1 || count > 100) throw new RangeError('invalid Queue batch count');
  const messages = [];
  for (let i = 0; i < count; i++) {
    const length = u32();
    if (length >= 128000 || length > bytes.length - offset) throw new RangeError('invalid Queue batch message');
    const text = decoder.decode(bytes.subarray(offset, offset + length));
    // The pinned native text-batch producer truncates at NUL. Reject rather
    // than silently accepting corrupted data; binary single-send is separate.
    if (text.includes('\0')) throw new TypeError('Queue text batch does not support NUL');
    messages.push({body:text,contentType:'text'});
    offset += length;
  }
  if (offset !== bytes.length) throw new TypeError('trailing Queue batch data');
  return messages;
}

export async function performQueue(method, queue, body, options) {
  // Decimal KB per the platform limits; this is not a provider acceptance guarantee.
  if (!(body instanceof Uint8Array)) throw new TypeError('Queue payload must be bytes');
  if (body.length > (method === 114 ? 256000 : 127999) || !/^\d+$/.test(options))
    throw new RangeError("invalid Queue payload or delay");
  const delaySeconds = Number(options);
  if (!Number.isSafeInteger(delaySeconds) || delaySeconds > 86400)
    throw new RangeError("invalid Queue delay");
  if (method !== 112 && method !== 113 && method !== 114) throw new TypeError("unknown Queue operation");
  if (method === 114) {
    // Parse every message before touching provider code. Strings/records are
    // owned, with no retained views into the caller's frame and no retries.
    const messages = textBatch(body);
    const sendBatch = queue?.sendBatch;
    if (typeof sendBatch !== 'function') throw new TypeError('Queue binding missing');
    await Reflect.apply(sendBatch, queue, [messages, {delaySeconds}]);
    return {status:0,bytes:new Uint8Array()};
  }
  // Decode/copy before accessing provider code, including a send getter. These
  // are UTF-8 string bytes, not a file whose leading BOM should be removed.
  const payload = method === 112 ? decoder.decode(body) : body.slice();
  const send = queue?.send;
  if (typeof send !== "function") throw new TypeError("Queue binding missing");
  await Reflect.apply(send, queue, [payload, { contentType: method === 112 ? "text" : "bytes", delaySeconds }]);
  return { status: 0, bytes: new Uint8Array() };
}
