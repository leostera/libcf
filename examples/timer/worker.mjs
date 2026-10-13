import factory from '../../build/timer.mjs';
import wasm from '../../build/timer.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
