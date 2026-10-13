import factory from '../../build/rpc.mjs';
import wasm from '../../build/rpc.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
