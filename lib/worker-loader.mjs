import { performService } from './service.mjs';
const encoder = new TextEncoder();
export async function performWorkerLoader(binding, url, body, source, helpers) {
  if (typeof source !== 'string' || !source.length || source.length > 65536)
    throw new TypeError('invalid dynamic Worker source');
  const encoded = encoder.encode(source);
  if (encoded.length > 65536) throw new RangeError('dynamic Worker source exceeds 64 KiB');
  const code = {
    compatibilityDate: '2026-10-13',
    compatibilityFlags: [],
    mainModule: 'main.js',
    modules: { 'main.js': source },
    env: {},
    globalOutbound: null,
    limits: { cpuMs: 50, subRequests: 0 },
  };
  // Validate the HTTP wire before creating a stub. Hash the complete JSON-only
  // code/config, not just source: changed policy must never reuse cached code.
  return performService({ async fetch(request) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(code))));
    const id = `libcf:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const worker = binding.get(id, () => code);
    return worker.getEntrypoint().fetch(request);
  } }, url, body, helpers);
}
