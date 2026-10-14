import factory from '../../build/analytics-sql.mjs';
import wasm from '../../build/analytics-sql.wasm';
import { createWorker } from '../../lib/runtime.mjs';
export default createWorker(factory, wasm);
