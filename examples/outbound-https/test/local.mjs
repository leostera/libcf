import worker from '../worker.mjs';
import factory from '../../../build/outbound-https.mjs';
import wasm from '../../../build/outbound-https.wasm';
import { createWorker } from '../../../lib/runtime.mjs';
const unconfigured = createWorker(factory, wasm);
const wrongRole = createWorker(factory, wasm, { outboundPolicy: JSON.stringify([{ kind: 'vpc-network', binding: 'CERT', name: 'health', url: 'https://owned.invalid/health' }]) });
const encoder = new TextEncoder();
function fake(label) {
  const binding = { async fetch(request) {
    const url = new URL(request.url);
    if (this !== binding || url.origin !== 'https://owned.invalid' || request.method !== 'GET' || request.redirect !== 'manual' || request.body !== null || [...request.headers].length)
      throw new Error('mock request mismatch');
    const name = url.pathname.slice(1);
    if (name === 'fetch-fail') throw new Error('private provider diagnostic');
    if (name === 'bad-kind') return {};
    if (name === 'slow-fetch') await new Promise(resolve => setTimeout(resolve, 100));
    let body = encoder.encode(label + ':' + name);
    if (name === 'binary') body = new Uint8Array([0, 255, 128, 13, 10]);
    if (name === 'empty') body = null;
    if (name === 'maximum' || name === 'oversized') body = new Uint8Array(name === 'maximum' ? 1048576 : 1048577).fill(7);
    if (name === 'body-fail') body = new ReadableStream({ start(c) { c.error(new Error('private stream diagnostic')); } });
    if (name === 'slow-body') {
      let timer, settle, canceled = false;
      body = new ReadableStream({ pull(c) { return new Promise(resolve => {
        settle = resolve; timer = setTimeout(() => { if (!canceled) { c.enqueue(new Uint8Array([1])); c.close(); } resolve(); }, 100);
      }); }, cancel() { canceled = true; clearTimeout(timer); settle?.(); } }, { highWaterMark: 0 });
    }
    const response = new Response(body, { status: name === 'redirect' ? 302 : name === 'error' ? 403 : 200,
      headers: name === 'redirect' ? { location: 'https://owned.invalid/forbidden' } : {} });
    response[Symbol.dispose] = () => { if (name === 'cleanup-fail') throw new Error('private cleanup diagnostic'); };
    return response;
  }, [Symbol.dispose]() { throw new Error('borrowed mock binding disposed'); } };
  return binding;
}
const CERT = fake('mtls'), SERVICE = fake('vpc-service'), NETWORK = fake('vpc-network');
// Query switches exist ONLY in this explicit test entry, never the production
// wrapper. No provider calls leave this isolate; they cannot prove TLS/routing.
export default { fetch(request, env, ctx) {
  const mode = new URL(request.url).searchParams.get('mock');
  return (mode === 'no-policy' ? unconfigured : mode === 'wrong-role' ? wrongRole : worker).fetch(
    request, { ...env, ...(mode === 'missing-binding' ? {} : { CERT }), SERVICE, NETWORK }, ctx);
} };
