import factory from '../../build/crypto.mjs';
import wasm from '../../build/crypto.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
