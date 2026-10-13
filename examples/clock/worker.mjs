import factory from '../../build/clock.mjs';
import wasm from '../../build/clock.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
