import factory from "../../build/service.mjs";
import wasm from "../../build/service.wasm";
import { createWorker } from "../../lib/runtime.mjs";
export default createWorker(factory, wasm);
