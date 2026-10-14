import factory from '../../build/stream.mjs';
import wasm from '../../build/stream.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
