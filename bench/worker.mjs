import factory from '../build/benchmark.mjs';
import wasm from '../build/benchmark.wasm';
import { createWorker } from '../lib/runtime.mjs';
export default createWorker(factory, wasm);
