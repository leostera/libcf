import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { liveHttp, awaitCertificate } from './live-http.mjs';

const host = process.argv[2];
const request = liveHttp(host, 'websocket'); // Validate before creating any socket.
await awaitCertificate(request);
const sockets = [];
function event(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`WebSocket ${type} timed out`)); }, 10000);
    function cleanup() { clearTimeout(timeout); socket.removeEventListener(type, done); socket.removeEventListener('error', fail); }
    function done(value) { cleanup(); resolve(value); }
    function fail() { cleanup(); reject(new Error('WebSocket transport failure')); }
    socket.addEventListener(type, done, { once: true });
    if (type !== 'close') socket.addEventListener('error', fail, { once: true });
  });
}
async function connect(room = randomUUID()) {
  const socket = new WebSocket(`wss://${host}/rooms/${room}/connect`);
  sockets.push(socket);
  socket.binaryType = 'arraybuffer';
  await event(socket, 'open');
  return { socket, room };
}
async function exchange(socket, body) {
  const response = event(socket, 'message');
  socket.send(body);
  return (await response).data;
}
try {
  const { socket, room } = await connect();
  assert.equal(await exchange(socket, 'hello ☁'), 'hello ☁');
  const bytes = Uint8Array.of(0, 255, 128, 65);
  assert.deepEqual(new Uint8Array(await exchange(socket, bytes)), bytes);
  const before = await request(`/rooms/${room}/stats`);
  const initializations = Number(before.headers.get('x-initializations'));
  assert.equal(await before.text(), '2');
  assert(Number.isSafeInteger(initializations) && initializations >= 1);
  // Idle observation is not forced eviction. Only claim reconstruction if the
  // persisted constructor counter advances while this same socket survives.
  await new Promise(resolve => setTimeout(resolve, 15000));
  assert.equal(await exchange(socket, 'after-idle'), 'after-idle');
  const after = await request(`/rooms/${room}/stats`);
  const afterInitializations = Number(after.headers.get('x-initializations'));
  assert.equal(await after.text(), '3');
  const closed = event(socket, 'close');
  socket.close(1000, 'client done');
  assert.equal((await closed).code, 1000);
  let closeObserved = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const stats = await request(`/rooms/${room}/stats`);
    await stats.arrayBuffer();
    if (Number(stats.headers.get('x-closes')) >= 1) {
      assert.equal(stats.headers.get('x-last-code'), '1000');
      closeObserved = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(closeObserved, 'C++ close effect not persisted');
  const normal = await connect();
  const normalClose = event(normal.socket, 'close');
  normal.socket.send('close');
  assert.equal((await normalClose).code, 1000);
  const failed = await connect();
  const failedClose = event(failed.socket, 'close');
  failed.socket.send('fail');
  assert.equal((await failedClose).code, 1011);
  const oversized = await connect();
  const oversizedClose = event(oversized.socket, 'close');
  oversized.socket.send(new Uint8Array(1024 * 1024 + 1));
  assert.equal((await oversizedClose).code, 1009);
  assert.equal(await (await request(`/rooms/${oversized.room}/stats`)).text(), '0');
  assert.equal((await request('/rooms/check/connect')).status, 426);
  assert.equal((await request('/rooms/check/deny')).status, 403);
  console.log(JSON.stringify({ host, passed: ['text/binary', 'durable state', 'client/server close', 'handler failure', 'frame limit', 'upgrade guards'], initializations, afterInitializations, liveReconstructionObserved: afterInitializations > initializations }));
} finally {
  for (const socket of sockets) socket.close();
}
