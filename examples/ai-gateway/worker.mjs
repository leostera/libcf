import factory from '../../build/ai-gateway.mjs';
import wasm from '../../build/ai-gateway.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
