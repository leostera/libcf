import { DurableObject } from 'cloudflare:workers';
import factory from '../../build/durable.mjs';
import wasm from '../../build/durable.wasm';
import { createWorker } from '../../lib/runtime.mjs';

// Platform fixture: the client is C++, but this initial object's implementation
// is deliberately JS. C++-authored lifecycle/storage handlers are a next slice.
export class Counter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO counter(id,value) VALUES (1,0)');
  }
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/increment' && request.method === 'POST') {
      const row = this.ctx.storage.sql.exec('UPDATE counter SET value=value+1 WHERE id=1 RETURNING value').one();
      return Response.json(row);
    }
    if (path === '/value' && request.method === 'GET')
      return Response.json(this.ctx.storage.sql.exec('SELECT value FROM counter WHERE id=1').one());
    if (path === '/echo' && request.method === 'POST')
      return new Response(request.body, { status: 201, headers: { 'x-object-header': request.headers.get('x-original') ?? 'absent' } });
    if (path === '/rollback' && request.method === 'POST') {
      try {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec('UPDATE counter SET value=value+100 WHERE id=1');
          this.ctx.storage.sql.exec('INSERT INTO counter(id,value) VALUES (2,NULL)');
        });
      } catch { return new Response('rolled back', { status: 409 }); }
      return new Response('unexpected commit', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  }
}

export default createWorker(factory, wasm);
