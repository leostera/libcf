import factory from '../../build/email.mjs';
import wasm from '../../build/email.wasm';
import { createEmailWorker } from '../../lib/email.mjs';
export default createEmailWorker(factory, wasm);
