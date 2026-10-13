import factory from '../../build/r2.mjs';
import wasm from '../../build/r2.wasm';
import { createWorker } from '../../lib/runtime.mjs';

export default createWorker(factory, wasm);
