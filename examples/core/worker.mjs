import createCppWorker from "../../build/core.mjs";
import compiledWasm from "../../build/core.wasm";
import { createWorker } from "../../lib/runtime.mjs";

const worker = createWorker(createCppWorker, compiledWasm);

export default {
  async fetch(request, env, ctx) {
    // Local-test readback of a background write; not a public C++ route.
    const url = new URL(request.url);
    if (url.pathname === "/background-status") {
      const value = await env.STATE_KV.get(url.searchParams.get("key") ?? "");
      return value === null ? new Response("not found", { status: 404 }) : new Response(value);
    }
    return worker.fetch(request, env, ctx);
  },
};
