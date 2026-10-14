import factory from '../../build/ai.mjs';
import wasm from '../../build/ai.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
