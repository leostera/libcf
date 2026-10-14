import factory from '../../build/flagship.mjs';
import wasm from '../../build/flagship.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
