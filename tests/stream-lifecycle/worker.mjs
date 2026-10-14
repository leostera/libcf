import factory from '../../build/stream-lifecycle-probe.mjs';
import wasm from '../../build/stream-lifecycle-probe.wasm';
import { createWorker } from '../../lib/runtime.mjs';
const worker = createWorker(factory, wasm);
let incomingAborts = 0;

function parseStats(text) {
  const values = text.split(' ').map(Number);
  if (values.length !== 6 || values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('invalid probe stats');
  const [cpp, pulls, chunks, released, active, sessions] = values;
  return {cpp,pulls,chunks,released,active,sessions};
}
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/signal-stats') return Response.json({incomingAborts});
    if (path === '/stream') request.signal.addEventListener('abort', () => { incomingAborts++; }, {once:true});
    if (path !== '/inspect') return worker.fetch(request, env, ctx);
    const get = path => worker.fetch(new Request(new URL(path, request.url)), env, ctx);
    const stats = async () => parseStats(await (await get('/stats')).text());
    const before = await stats();
    const response = await get('/stream');
    if (response.status !== 200) throw new Error('probe stream unavailable');
    const reader = response.body.getReader();
    let opened, consumed, first, second, retainedZero;
    try {
      opened = await stats();
      const chunk = await reader.read();
      first = {done:chunk.done,length:chunk.value?.length,zero:chunk.value?.every(byte=>byte===0)};
      const next = await reader.read();
      second = {done:next.done,length:next.value?.length,one:next.value?.every(byte=>byte===1)};
      consumed = await stats();
      retainedZero = chunk.value.every(byte=>byte===0);
    } finally {
      try { await reader.cancel('owned local probe complete'); } finally { reader.releaseLock(); }
    }
    return Response.json({before,opened,consumed,first,second,retainedZero,after:await stats()});
  },
};
