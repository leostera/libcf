import worker from '../worker.mjs';
// Explicit fake gateways, never a native AI binding or backend lookup.
const AI = { async gateway(...args) {
  if (this !== AI || args.length !== 1) throw new Error('invalid gateway lookup');
  const [id] = args;
  if (id === 'lookup-fail') throw new Error('private backend diagnostic');
  if (id === 'lookup-slow') await new Promise(resolve => setTimeout(resolve, 200));
  let disposed = false;
  const gateway = { async getUrl(...args) {
    if (this !== gateway || disposed || args.length > 1) throw new Error('invalid gateway call');
    const provider = args[0];
    if (provider !== undefined && provider !== 'openai' && provider !== 'universal' && provider !== 'p'.repeat(64)) throw new Error('unexpected provider');
    if (id === 'read-slow') await new Promise(resolve => setTimeout(resolve, 200));
    if (id === 'read-fail') throw new Error('private URL diagnostic');
    if (id === 'bad-host') return 'https://example.test/';
    if (id === 'bad-type') return { url: 'not a string' };
    const account = id.length === 64 ? 'a'.repeat(128) : 'synthetic-account';
    return `https://gateway.ai.cloudflare.com/v1/${account}/${id === 'bad-id' ? 'other' : id}/${id === 'bad-provider' ? 'other' : !provider || provider === 'universal' ? '' : provider}`;
  }, [Symbol.dispose]() {
    if (disposed) throw new Error('gateway disposed twice'); disposed = true;
    if (id === 'cleanup-fail') throw new Error('cleanup failed');
  }, get run() { throw new Error('inference forbidden'); }, get getLog() { throw new Error('log access forbidden'); } };
  return gateway;
}, [Symbol.dispose]() { throw new Error('borrowed AI binding disposed'); }, get run() { throw new Error('AI inference forbidden'); } };
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, AI }, ctx); } };
