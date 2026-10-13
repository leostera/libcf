import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
class Capability extends RpcTarget { ping() { return 42; } }
export default class Reference extends WorkerEntrypoint {
  echo(value) { return value; }
  sum(a, b) { return a + b; }
  fail() { throw new Error('synthetic RPC failure'); }
  capability() { return { target: new Capability() }; }
  large() { return 'x'.repeat(1048576); }
  fetch() { return new Response('not found', { status: 404 }); }
}
