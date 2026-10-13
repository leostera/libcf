import factory from '../../build/d1.mjs';
import wasm from '../../build/d1.wasm';
import { createWorker } from '../../lib/runtime.mjs';

export default createWorker(factory, wasm);
