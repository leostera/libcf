import factory from '../../build/media.mjs';
import wasm from '../../build/media.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
