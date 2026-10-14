import factory from '../../build/agent-memory.mjs';
import wasm from '../../build/agent-memory.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
