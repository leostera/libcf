import worker from '../worker.mjs';

// Explicit fixture, not the native Vectorize binding or a vector-search emulator.
const INDEX = {
  async query(vector, options) {
    if (this !== INDEX || options.returnMetadata !== 'none' || options.returnValues !== false)
      throw new Error('invalid query contract');
    if (vector.length !== 3) throw new Error('fixture dimensions mismatch');
    if (vector[0] === -1) throw new Error('fixture provider failure');
    if (vector[0] === 9) await new Promise(resolve => setTimeout(resolve, 200));
    if (vector[0] === 0) return { count: 0, matches: [] };
    if (vector[0] === -2) return { count: 1, matches: [{ id: 'bad', score: NaN }] };
    return { count: 1, matches: [{ id: `query-${vector[0]}-猫`, score: vector[0] / 4 }] };
  },
};
export default {
  fetch(request, env, ctx) { return worker.fetch(request, { ...env, INDEX }, ctx); },
};
