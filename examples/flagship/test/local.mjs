import worker from '../worker.mjs';
// Explicit fake evaluator. No app, flag administration or remote binding.
const FLAGS = { async getBooleanDetails(key, fallback, context) {
  if (this !== FLAGS || key !== 'libcf-owned-flag' || fallback !== true) throw new Error('unexpected evaluation');
  const target = context?.targetingKey;
  if (target === 'slow') await new Promise(resolve => setTimeout(resolve, 200));
  if (target === 'throw') throw new Error('fixture failure');
  if (target === 'fallback') return { flagKey: key, value: fallback, reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND', errorMessage: '' };
  if (target === 'maximum') return { flagKey: key, value: true, variant: 'v'.repeat(256), reason: 'r'.repeat(64), errorCode: 'c'.repeat(64), errorMessage: 'm'.repeat(4096) };
  return { flagKey: key, value: target === 'bad' ? 1 : false, variant: target ?? '', reason: 'STATIC',
    errorMessage: '\ufeffowned\0猫', [Symbol.dispose]() { if (target === 'cleanup-fail') throw new Error('cleanup failure'); } };
}, [Symbol.dispose]() { throw new Error('borrowed binding disposed'); } };
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, FLAGS }, ctx); } };
