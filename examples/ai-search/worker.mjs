import factory from '../../build/ai-search.mjs';
import wasm from '../../build/ai-search.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
