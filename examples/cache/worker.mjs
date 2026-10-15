import factory from "../../build/cache.mjs";
import wasm from "../../build/cache.wasm";
import { createWorker } from "../../lib/runtime.mjs";
export default createWorker(factory, wasm);
