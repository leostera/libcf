import { parseBoundedJson } from './json.mjs';
const states = ['queued', 'running', 'paused', 'errored', 'terminated', 'complete', 'waiting', 'waitingForPause', 'rollingBack', 'unknown'];
export async function performWorkflow(method, binding, id, body, options) {
  if (typeof id !== 'string' || /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.exec(id)?.[0] !== id)
    throw new TypeError('invalid workflow instance ID');
  if (options || !(body instanceof Uint8Array)) throw new TypeError('invalid workflow command');
  if (method === 272) {
    const params = parseBoundedJson(body);
    if (params === null || typeof params !== 'object' || Array.isArray(params))
      throw new TypeError('workflow params must be a JSON object');
    const instance = await binding.create({ id, params });
    if (instance?.id !== id) throw new TypeError('workflow creation returned unexpected ID');
    return { status: 0, bytes: new Uint8Array() };
  }
  if ((method !== 273 && method !== 274) || body.length)
    throw new TypeError('invalid workflow command');
  const instance = await binding.get(id);
  if (instance?.id !== id) throw new TypeError('workflow lookup returned unexpected ID');
  if (method === 274) {
    await instance.delete();
    return { status: 0, bytes: new Uint8Array() };
  }
  const result = await instance.status();
  const state = states.indexOf(result?.status);
  if (state < 0) throw new TypeError('invalid workflow state');
  return { status: 0, bytes: new Uint8Array([state]) };
}
