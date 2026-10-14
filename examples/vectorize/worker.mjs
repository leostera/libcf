import factory from '../../build/vectorize.mjs';
import wasm from '../../build/vectorize.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
