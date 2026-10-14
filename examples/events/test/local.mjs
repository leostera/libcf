import worker from '../worker.mjs';
const received = [];
export default {
  ...worker,
  queue(batch,env,ctx) {
    for (const message of batch.messages) {
      if (received.length < 128) received.push(typeof message.body === 'string'
        ? {length:message.body.length,text:message.body.slice(0,64)} : {type:typeof message.body});
    }
    return worker.queue(batch,env,ctx);
  },
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/control/received') return Response.json(received);
    if (path === '/control/send-batch') {
      const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await request.arrayBuffer());
      await env.EVENTS.sendBatch([{body:text,contentType:'text'}],{delaySeconds:0});
      return new Response('control queued',{status:202});
    }
    return worker.fetch(request, env, ctx);
  },
};
