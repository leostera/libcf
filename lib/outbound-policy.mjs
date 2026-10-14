import { parseBoundedJson } from './json.mjs';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const policies = new WeakMap();
const kinds = new Set(['mtls', 'vpc-service', 'vpc-network']);
function selector(kind, binding, name) {
  if (!kinds.has(kind) || typeof binding !== 'string' || typeof name !== 'string' ||
      binding.length > 64 || name.length > 64 ||
      /^[A-Z][A-Z0-9_]*$/.exec(binding)?.[0] !== binding ||
      /^[a-z][a-z0-9-]*$/.exec(name)?.[0] !== name)
    throw new TypeError('invalid outbound endpoint selector');
  return `${kind}\0${binding}\0${name}`;
}
function destination(kind, value) {
  if (typeof value !== 'string' || !value.length || value.length > 2048 || /[^\x21-\x7e]/.test(value))
    throw new TypeError('invalid outbound HTTPS URL');
  let url;
  try { url = new URL(value); } catch { throw new TypeError('invalid outbound HTTPS URL'); }
  // Exact serialization, not normalization of caller input. DNS resolution,
  // routing, certificate identity and server path semantics are not established.
  if (url.protocol !== 'https:' || url.href !== value || url.username || url.password ||
      value.includes('?') || value.includes('#') || url.hostname.endsWith('.') ||
      url.port === '0' || (kind === 'vpc-service' && url.port))
    throw new TypeError('invalid outbound HTTPS authority');
  return value;
}

// Trusted deployment policy only. Parsing establishes syntax and role consistency,
// not permission to use a certificate/network, binding provenance or verify_full.
// This prototype registers GET-only destinations: no caller URL/path/header/body
// inputs. No fetch, DNS lookup, certificate inspection or provider call occurs.
export function parseBoundHttpsPolicy(json) {
  if (typeof json !== 'string' || !json.length || json.length > 65536) throw new TypeError('invalid outbound policy text');
  const bytes = encoder.encode(json);
  if (bytes.length > 65536 || decoder.decode(bytes) !== json) throw new TypeError('invalid outbound policy UTF-8');
  let entries;
  try { entries = parseBoundedJson(bytes); } catch { throw new TypeError('invalid outbound policy JSON'); }
  if (!Array.isArray(entries) || entries.length > 64) throw new TypeError('invalid outbound policy entries');
  const selected = new Map(), roles = new Map();
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'binding,kind,name,url') throw new TypeError('invalid outbound policy entry');
    const { kind, binding, name, url } = entry;
    const key = selector(kind, binding, name);
    if (selected.has(key) || (roles.has(binding) && roles.get(binding) !== kind)) throw new TypeError('ambiguous outbound policy');
    const endpoint = Object.freeze({ kind, binding, name, url: destination(kind, url) });
    roles.set(binding, kind); selected.set(key, endpoint);
  }
  const token = Object.freeze({}); policies.set(token, selected); return token;
}

// Role+binding+name must all match; there is no raw URL or cross-role fallback.
export function selectBoundHttpsEndpoint(policy, kind, binding, name) {
  const key = selector(kind, binding, name);
  const entries = policies.get(policy);
  if (!entries) throw new TypeError('invalid outbound policy token');
  const endpoint = entries.get(key);
  if (!endpoint) throw new TypeError('outbound endpoint is not configured');
  return endpoint;
}
