import factory from '../../build/container.mjs';
import wasm from '../../build/container.wasm';
import { createWorker } from '../../lib/runtime.mjs';
import { createDurableObject } from '../../lib/durable-object.mjs';
export const Inspection = createDurableObject(factory, wasm);
export default createWorker(factory, wasm);
