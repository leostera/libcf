import factory from '../../build/legacy-sites.mjs';
import wasm from '../../build/legacy-sites.wasm';
import manifestText from '__STATIC_CONTENT_MANIFEST';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm, { sitesManifest: manifestText });
