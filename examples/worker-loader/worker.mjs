import factory from '../../build/worker-loader.mjs';
import wasm from '../../build/worker-loader.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
