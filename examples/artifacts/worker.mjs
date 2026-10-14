import factory from '../../build/artifacts.mjs';
import wasm from '../../build/artifacts.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
