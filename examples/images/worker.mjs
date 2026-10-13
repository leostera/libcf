import factory from '../../build/images.mjs';
import wasm from '../../build/images.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
