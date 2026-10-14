import worker from '../worker.mjs';
import { png, testTokenHash } from './fixture.mjs';

// Explicit provider mock: no codec, native Media binding, resizing or remote work.
const MEDIA = { input(stream) {
  if (this !== MEDIA) throw new Error('invalid input receiver');
  let used = false;
  return { transform({ width, height, fit }) {
    if (width !== 128 || height !== 128 || fit !== 'contain') throw new Error('invalid transform');
    return { output({ mode, time, format }) {
      if (mode !== 'frame' || time !== '0s' || format !== 'png') throw new Error('invalid output');
      return { async response() {
        if (used) throw new Error('single-use fixture');
        used = true;
        const input = new Uint8Array(await new Response(stream).arrayBuffer());
        if (input[0] === 255) throw new Error('fixture decode failure');
        if (input[0] === 254) await new Promise(resolve => setTimeout(resolve, 200));
        return new Response(png, { headers: { 'content-type': input[0] === 253 ? 'video/mp4' : 'image/png' } });
      } };
    } };
  } };
} };
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, MEDIA, LIBCF_MEDIA_PROBE_SHA256: testTokenHash }, ctx); } };
