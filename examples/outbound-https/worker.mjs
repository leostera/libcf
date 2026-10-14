import factory from '../../build/outbound-https.mjs';
import wasm from '../../build/outbound-https.wasm';
import { createWorker } from '../../lib/runtime.mjs';
// Synthetic, fixed destinations for the explicit local fixture. Not a native
// certificate/network authorization or deployment plan. Never take this policy
// from a request or use an arbitrary incoming URL/Host/Authorization header.
const names = ['health', 'binary', 'empty', 'maximum', 'oversized', 'redirect', 'error', 'fetch-fail', 'cleanup-fail', 'slow-fetch', 'slow-body', 'body-fail', 'bad-kind', 'a'.repeat(64)];
const outboundPolicy = JSON.stringify([
  ['mtls', 'CERT'], ['vpc-service', 'SERVICE'], ['vpc-network', 'NETWORK'],
].flatMap(([kind, binding]) => names.map(name => ({ kind, binding, name, url: 'https://owned.invalid/' + name }))));
export default createWorker(factory, wasm, { outboundPolicy });
