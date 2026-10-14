import worker, { Inspection as Base } from '../worker.mjs';
export default worker;

// Real DO/C++/Wasm, explicitly fake Container metadata. No Container declaration,
// engine, native process or lifecycle method. Only the test subclass wraps ctx.
export class Inspection extends Base {
  constructor(native, env) {
    const modeState = { value: undefined };
    const capability = {
      async inspect() {
        if (this !== capability) throw new Error('lost receiver');
        const mode = modeState.value;
        if (mode === '/short-timeout') await new Promise(resolve => setTimeout(resolve, 200));
        if (mode === '/none') return null;
        if (mode === '/starting') return { image: '', labels: {} };
        if (mode === '/bad') return { image: 1, labels: {} };
        if (mode === '/maximum') return { image: 'i'.repeat(2048),
          labels: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['k'.repeat(15) + i, 'v'.repeat(64)])) };
        return { image: '\ufeffimage\0猫', labels: { owner: 'libcf', empty: '' },
          [Symbol.dispose]() { if (mode === '/cleanup-fail') throw new Error('fixture cleanup failure'); } };
      },
      get running() { throw new Error('unexpected running read'); },
      start() { throw new Error('unexpected start'); },
      destroy() { throw new Error('unexpected destroy'); },
      [Symbol.dispose]() { throw new Error('borrowed capability disposed'); },
    };
    const context = new Proxy(native, { get(target, key) {
      if (key === 'container') return capability;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    super(native, env);
    Object.defineProperty(this, 'ctx', { value: context });
    this.modeState = modeState;
  }
  fetch(request) {
    const mode = new URL(request.url).pathname;
    if (this.modeState.value !== undefined && this.modeState.value !== mode) throw new Error('fixture identity changed');
    this.modeState.value = mode; // Each whitelisted scenario is routed to a distinct DO.
    return super.fetch(request);
  }
}
