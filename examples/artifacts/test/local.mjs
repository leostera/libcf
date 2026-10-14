import worker from '../worker.mjs';
// Explicit fake repositories: no Artifacts binding, account, Git or credentials.
const ARTIFACTS = { async get(name) {
  if (this !== ARTIFACTS) throw new Error('unexpected receiver');
  if (name === 'not-found') throw new Error('repository not found');
  if (name === 'lookup-slow') await new Promise(resolve => setTimeout(resolve, 200));
  let disposed = false;
  const repository = { async info(...args) {
    if (this !== repository || disposed || args.length) throw new Error('invalid repository call');
    if (name === 'read-slow') await new Promise(resolve => setTimeout(resolve, 200));
    return { id: name.length === 128 ? 'i'.repeat(128) : '\ufeffid\0猫', name,
      defaultBranch: name.length === 128 ? 'b'.repeat(256) : 'main', readOnly: name === 'bad' ? 1 : name.length === 128,
      get token() { throw new Error('credential accessed'); }, get remote() { throw new Error('URL accessed'); } };
  }, [Symbol.dispose]() {
    if (disposed) throw new Error('repository disposed twice'); disposed = true;
    if (name === 'cleanup-fail') throw new Error('cleanup failure');
  } };
  return repository;
}, [Symbol.dispose]() { throw new Error('borrowed namespace disposed'); } };
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, ARTIFACTS }, ctx); } };
