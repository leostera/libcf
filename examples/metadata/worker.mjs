import factory from '../../build/metadata.mjs';
import wasm from '../../build/metadata.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
