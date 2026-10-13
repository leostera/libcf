import factory from '../../build/http-client.mjs';
import wasm from '../../build/http-client.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
