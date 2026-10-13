import { readBounded } from './body.mjs';
const MAX_FRAME = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export async function upgradeSocket(request, response, state) {
  if (response.headers.get('x-libcf-ws-action') !== 'accept') return response;
  await readBounded(response.body, 0);
  if (!response.ok || request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
    return new Response('WebSocket upgrade required', { status: 426 });
  const pair = new WebSocketPair();
  state.acceptWebSocket(pair[1]);
  const headers = new Headers(response.headers);
  headers.delete('x-libcf-ws-action');
  return new Response(null, { status: 101, webSocket: pair[0], headers });
}

export function socketMessage(message) {
  const text = typeof message === 'string';
  if (!text && !(message instanceof ArrayBuffer)) throw new TypeError('invalid native WebSocket message');
  const body = text ? encoder.encode(message) : new Uint8Array(message);
  if (body.byteLength > MAX_FRAME) throw new RangeError('WebSocket input exceeds 1 MiB');
  return { body, metadata: { __LIBCF_WS_KIND: 'message', __LIBCF_WS_FORMAT: text ? 'text' : 'bytes' } };
}

export async function applySocketResponse(socket, response, allowSend = true) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('C++ WebSocket handler failed');
  }
  const action = response.headers.get('x-libcf-ws-action');
  if (action === 'ignore') { await readBounded(response.body, 0); return; }
  if (!allowSend) {
    await response.body?.cancel();
    throw new Error('terminal WebSocket handlers must return websocket_ignore');
  }
  if (action === 'send') {
    const bytes = await readBounded(response.body);
    const format = response.headers.get('x-libcf-ws-format');
    if (format === 'text') socket.send(decoder.decode(bytes));
    else if (format === 'bytes') socket.send(bytes);
    else throw new Error('invalid WebSocket response format');
    return;
  }
  if (action === 'close') {
    const codeText = response.headers.get('x-libcf-ws-code');
    const code = Number(codeText);
    const standard = [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014].includes(code);
    if (!/^\d+$/.test(codeText ?? '') || !Number.isInteger(code) || (!standard && (code < 3000 || code > 4999)))
      throw new Error('invalid WebSocket close code');
    socket.close(code, decoder.decode(await readBounded(response.body, 123)));
    return;
  }
  await response.body?.cancel();
  throw new Error('missing WebSocket response action');
}
