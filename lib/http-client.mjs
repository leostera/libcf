import { performService } from './service.mjs';
const encoder = new TextEncoder();
export async function performHttp(url, body, redirect, helpers, signal, fetcher) {
  if (!['manual', 'error', 'follow'].includes(redirect)) throw new TypeError('invalid redirect mode');
  if (typeof url !== 'string' || !url.length || url.length > 65536 || encoder.encode(url).length > 65536)
    throw new RangeError('invalid HTTP URL size');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new TypeError('HTTP requires an http(s) URL without embedded credentials');
  signal?.throwIfAborted();
  return performService({ fetch(request) {
    signal?.throwIfAborted();
    return fetcher(request, { redirect, signal });
  } }, url, body, { ...helpers,
    readBounded: stream => helpers.readBounded(stream, 1048576, signal),
  });
}
