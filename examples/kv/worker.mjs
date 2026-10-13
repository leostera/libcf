import factory from '../../build/kv.mjs';
import wasm from '../../build/kv.wasm';
import { createWorker } from '../../lib/runtime.mjs';

export default createWorker(factory, wasm);
