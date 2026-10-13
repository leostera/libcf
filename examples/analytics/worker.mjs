import factory from "../../build/analytics.mjs";
import wasm from "../../build/analytics.wasm";
import { createWorker } from "../../lib/runtime.mjs";
export default createWorker(factory, wasm);
