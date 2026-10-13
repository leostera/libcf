import factory from '../../build/pipeline.mjs';
import wasm from '../../build/pipeline.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
