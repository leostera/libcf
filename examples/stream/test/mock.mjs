import worker from '../worker.mjs';
// Error/deadline fixture only. Successful native simulator reads use local.mjs.
const STREAM = {
  get videos() { return { list() { return []; } }; },
  video(id) { return { async details() {
    if (id === 'fail') throw new Error('fixture failure');
    if (id === 'slow') await new Promise(resolve => setTimeout(resolve, 200));
    return { id: id === 'mismatch' ? 'other' : id,
      status: { state: id === 'bad-state' ? 'x'.repeat(65) : 'ready' },
      readyToStream: true, size: id === 'bad-size' ? Number.MAX_SAFE_INTEGER + 1 : 448,
      duration: id === 'bad-duration' ? -0.5 : 0.125 };
  } }; },
};
export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, STREAM }, ctx); } };
