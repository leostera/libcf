import factory from '../../build/durable.mjs';
import wasm from '../../build/durable.wasm';
import objectFactory from '../../build/durable-object.mjs';
import objectWasm from '../../build/durable-object.wasm';
import { createWorker } from '../../lib/runtime.mjs';
import { createDurableObject } from '../../lib/durable-object.mjs';

export const Counter = createDurableObject(objectFactory, objectWasm);
export default createWorker(factory, wasm);
