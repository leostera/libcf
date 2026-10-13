import factory from '../../build/events.mjs';
import wasm from '../../build/events.wasm';
import { createEventWorker } from '../../lib/events.mjs';
export default createEventWorker(factory, wasm);
