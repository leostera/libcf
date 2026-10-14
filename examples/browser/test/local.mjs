import worker from '../worker.mjs';
import { png } from './fixture.mjs';

// Explicit fake renderer. No browser binding, Chrome, native layout or remote calls.
const BROWSER = { async quickAction(action, options) {
  if (this !== BROWSER || action !== 'screenshot' || typeof options.html !== 'string' ||
      options.viewport.width !== 128 || options.viewport.height !== 128 || options.viewport.deviceScaleFactor !== 1 ||
      options.screenshotOptions.type !== 'png' || options.screenshotOptions.encoding !== 'binary' ||
      options.screenshotOptions.fullPage !== false || options.screenshotOptions.captureBeyondViewport !== false ||
      options.setJavaScriptEnabled !== false || options.rejectRequestPattern?.join() !== '.*' ||
      options.cacheTTL !== 0 || options.bestAttempt !== false || options.gotoOptions.waitUntil !== 'domcontentloaded' ||
      options.gotoOptions.timeout !== options.actionTimeout || ![5, 5000].includes(options.actionTimeout) ||
      'url' in options || 'signal' in options)
    throw new Error('unexpected Browser request');
  if (options.html === 'fail') throw new Error('fixture failure');
  if (options.html === 'slow') await new Promise(resolve => setTimeout(resolve, 200));
  let bytes = png;
  if (options.html === 'bad-signature') bytes = new Uint8Array(8);
  if (options.html === 'oversized') bytes = new Uint8Array(1048577);
  if (options.html === 'max-output') { bytes = new Uint8Array(1048576); bytes.set(png); }
  return new Response(bytes, { status: options.html === 'bad-status' ? 503 : 200,
    headers: { 'content-type': options.html === 'bad-mime' ? 'application/json' : 'image/png' } });
} };
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, BROWSER }, ctx); } };
