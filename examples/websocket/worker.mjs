import factory from '../../build/websocket.mjs';
import wasm from '../../build/websocket.wasm';
import { createDurableObject } from '../../lib/durable-object.mjs';
export const Room = createDurableObject(factory, wasm);
export default {
  fetch(request, env) {
    const match = /^\/rooms\/([^/]+)\/(connect|deny|stats)$/.exec(new URL(request.url).pathname);
    if (!match) return new Response('not found', { status: 404 });
    // Upgrade responses retain their native socket here. The buffered C++ stub
    // fetch API cannot yet forward WebSocket upgrades.
    return env.ROOMS.getByName(match[1]).fetch(request);
  },
};
