import worker from '../worker.mjs';

// Explicit fake provider. No Agent Memory binding, profile persistence or AI work.
const entry = (summary = '\ufeffsummary\0owned') => ({ id: 'memory-猫', type: 'fact', summary,
  sessionId: null, createdAt: new Date(-1), updatedAt: new Date(1) });
const MEMORY = { getProfile(name) {
  if (this !== MEMORY || name !== 'libcf-owned-example') throw new Error('unexpected profile');
  let disposed = false, cleanupFailure = false;
  const profile = { async list(options) {
    if (this !== profile || disposed || ![20, 50].includes(options.limit) || Object.keys(options).some(key => !['limit', 'cursor'].includes(key)))
      throw new Error('unexpected list request');
    const cursor = options.cursor;
    if (cursor === 'fail') throw new Error('fixture failure');
    if (cursor === 'slow') await new Promise(resolve => setTimeout(resolve, 200));
    if (cursor === 'page-2' || cursor?.length === 2048) return { memories: [] };
    if (cursor === 'maximum') {
      if (options.limit !== 50) throw new Error('expected maximum limit');
      return { memories: Array.from({ length: 50 }, () => ({ id: 'i'.repeat(128), type: 'task', summary: 's'.repeat(4096),
        sessionId: 's'.repeat(64), createdAt: new Date(-8640000000000000), updatedAt: new Date(8640000000000000) })), cursor: 'c'.repeat(2048) };
    }
    if (cursor?.startsWith('echo-') || cursor?.startsWith('\ufeff')) return { memories: [entry(cursor)] };
    if (cursor === 'bad-date') return { memories: [{ ...entry(), createdAt: 'not a Date' }] };
    if (cursor === 'bad-type') return { memories: [{ ...entry(), type: 'unknown' }] };
    if (cursor === 'oversized') return { memories: [entry('x'.repeat(4097))] };
    if (cursor === 'bad-cursor') return { memories: [], cursor: '' };
    cleanupFailure = cursor === 'cleanup-fail';
    return { memories: [entry(), { ...entry(''), id: 'task', type: 'task', sessionId: '', createdAt: new Date(0), updatedAt: new Date(1000) }], cursor: 'page-2' };
  }, [Symbol.dispose]() {
    if (disposed) throw new Error('profile released twice');
    disposed = true;
    if (cleanupFailure) throw new Error('fixture cleanup failure');
  } };
  return Promise.resolve(profile);
}, [Symbol.dispose]() { throw new Error('borrowed namespace disposed'); } };
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, MEMORY }, ctx); } };
