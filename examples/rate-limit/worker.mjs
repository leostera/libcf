import factory from "../../build/rate-limit.mjs";
import wasm from "../../build/rate-limit.wasm";
import { createWorker } from "../../lib/runtime.mjs";
export default createWorker(factory, wasm);
