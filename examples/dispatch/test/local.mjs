import worker from '../worker.mjs';
export default {
  fetch(request, env, ctx) {
    // Namespace selection is explicitly mocked. The returned Fetcher is a real
    // local service binding, not a deployed WfP user Worker or CPU-limits emulator.
    const DISPATCHER = { get(name, args, options) {
      if (this !== DISPATCHER || Object.keys(args).length || options.limits.cpuMs !== 50 || options.limits.subRequests !== 0)
        throw new Error('invalid dispatch contract');
      if (name !== 'example') throw new Error('mock Worker not found');
      return env.REFERENCE;
    } };
    return worker.fetch(request, { ...env, DISPATCHER }, ctx);
  },
};
