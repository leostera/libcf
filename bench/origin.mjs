// Local origin for the I/O fan-out workload, reached through each gateway's
// ORIGIN service binding. GET /shard?seed=&id=&bytes=&delay= waits `delay` ms
// before sending headers, like a slow upstream, then returns the shard bytes.
import { shardBytes } from './shard.mjs';
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const number = name => Number(url.searchParams.get(name));
    if (url.pathname !== '/shard') return new Response('not found', { status: 404 });
    const delay = number('delay');
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    return new Response(shardBytes(number('seed'), number('id'), number('bytes')),
      { headers: { 'content-type': 'application/octet-stream' } });
  },
};
