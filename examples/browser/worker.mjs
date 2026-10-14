import factory from '../../build/browser.mjs';
import wasm from '../../build/browser.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
