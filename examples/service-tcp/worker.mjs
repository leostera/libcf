import factory from '../../build/service-tcp.mjs';
import wasm from '../../build/service-tcp.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
