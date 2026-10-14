import factory from '../../build/dispatch.mjs';
import wasm from '../../build/dispatch.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
