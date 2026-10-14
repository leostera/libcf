import factory from '../../build/media.mjs';
import wasm from '../../build/media.wasm';
import { createWorker } from '../../lib/runtime.mjs';
import { authenticatedMediaWorker } from './auth.mjs';
export default authenticatedMediaWorker(createWorker(factory, wasm));
