import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performHttp } from '../lib/http-client.mjs';
import { performService } from '../lib/service.mjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { readBounded } from '../lib/body.mjs';
import { encodeHeaders } from '../lib/header-wire.mjs';
const wire = new Uint8Array(Buffer.from('030000004745540000000000000000', 'hex'));
const helpers = { readBounded, encodeHeaders, encodeFields: fields => fields };
const url = 'https://upstream.libcf.leostera.dev/';

function requestWire(method, headers = [], body = new Uint8Array()) {
  const u32 = value => { const result = Buffer.alloc(4); result.writeUInt32LE(value); return result; };
  const field = bytes => Buffer.concat([u32(bytes.length), bytes]);
  const encodedHeaders = headers.map(([name, value]) => {
    const n = Buffer.from(name), v = Buffer.from(value);
    return Buffer.concat([u32(n.length), u32(v.length), n, v]);
  });
  return Buffer.concat([field(Buffer.from(method)), field(Buffer.concat(encodedHeaders)), field(body)]);
}

function invalidFieldWires() {
  const bom = String.fromCodePoint(0xFEFF);
  return [
    requestWire(bom + 'GET'), requestWire('GET\n'), requestWire('G ET'),
    ...[bom + 'x-test', '', 'x:test', 'x-test\n'].map(name=>requestWire('GET',[[name,'value']])),
    ...[0,1,8,10,11,12,13,14,31,127].map(code=>requestWire('GET',[['x-test','v'+String.fromCharCode(code)]])),
  ];
}

test('HTTP wire fields cannot hide invalid tokens behind a UTF-8 BOM', async () => {
  let accesses = 0;
  const binding = { get fetch() { accesses++; return () => new Response('unexpected'); } };
  for (const bytes of invalidFieldWires()) {
    await assert.rejects(performService(binding, url, bytes, helpers));
    await assert.rejects(performHttp(url, bytes, 'manual', helpers, undefined, () => {
      accesses++; return new Response('unexpected');
    }));
  }
  await assert.rejects(performService(binding,url,requestWire('GET',[['x-test',String.fromCodePoint(0xFEFF)+'value']]),helpers));
  assert.equal(accesses, 0);
});

test('pinned workerd preserves Unicode values but rejects invalid HTTP tokens', {timeout:15000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'libcf-service-wire-'));
  let runtime;
  try {
    const service = await readFile('lib/service.mjs','utf8');
    runtime = new Miniflare({host:'127.0.0.1',port:0,resourcePersistencePath:root,unsafeEnableSharedStorage:false,workers:[{config:{
      name:'service-wire-fixture',compatibilityDate:'2026-10-13',env:{},exports:{},
      manifest:{mainModule:'worker.mjs',modulesRoot:root,modules:{
        'service.mjs':{type:'esm',contents:service},
        'worker.mjs':{type:'esm',contents:`
          import { performService } from './service.mjs';
          export default { async fetch(input) {
            let accesses = 0, observed;
            const binding = { get fetch() {
              accesses++;
              return async function(request) {
                if (this !== binding) throw new Error('receiver changed');
                observed = {method:request.method,headers:[...request.headers],body:[...new Uint8Array(await request.arrayBuffer())]};
                return new Response('ok');
              };
            }};
            try {
              await performService(binding,'https://owned.invalid/',new Uint8Array(await input.arrayBuffer()),{
                encodeFields:fields=>fields,encodeHeaders:()=>new Uint8Array(),
                readBounded:async body=>new Uint8Array(await new Response(body).arrayBuffer()),
              });
              return Response.json({accesses,observed});
            } catch(error) { return Response.json({accesses,error:error.name}); }
          }};
        `},
      }},
    }}]});
    const run = async bytes => (await runtime.dispatchFetch('https://fixture.invalid/',{
      method:'POST',body:bytes,signal:AbortSignal.timeout(5000),
    })).json();
    const bom = String.fromCodePoint(0xFEFF);
    for (const bytes of invalidFieldWires()) {
      const result = await run(bytes);
      assert.equal(result.accesses,0,JSON.stringify(result));
      assert.equal(result.error,'TypeError');
    }
    const value = await run(requestWire('GET',[['x-test',bom + 'value']]));
    // Pinned workerd supports Unicode values that Node's ByteString API rejects.
    assert.equal(value.error,undefined);
    assert.equal(value.accesses,1);
    assert.deepEqual(value.observed.headers,[['x-test',bom + 'value']]);
    const tab = await run(requestWire('GET',[['x-test','a\tb']]));
    assert.deepEqual(tab.observed.headers,[['x-test','a\tb']]);
    const body = Uint8Array.of(239,187,191,0,255);
    const binary = await run(requestWire('POST',[],body));
    assert.equal(binary.accesses,1);
    assert.deepEqual(binary.observed.body,[...body]);
    const recovery = await run(requestWire('GET'));
    assert.equal(recovery.observed.method,'GET');
    console.log(JSON.stringify({nativeHeaderValue:value,bodyBytes:binary.observed.body}));
  } finally {
    try { await runtime?.dispose(); } finally { await rm(root,{recursive:true,force:true}); }
  }
});

test('redirect policy and cancellation signal reach native fetch', async () => {
  const controller = new AbortController();
  for (const redirect of ['manual', 'follow', 'error']) {
    const result = await performHttp(url, wire, redirect, helpers, controller.signal, async (request, options) => {
      assert.equal(request.url, url);
      assert.equal(options.redirect, redirect);
      assert.equal(options.signal, controller.signal);
      return new Response('fixture', { status: 201 });
    });
    assert.equal(result.status, 0);
    assert.equal(result.bytes[0], '201');
    assert.equal(new TextDecoder().decode(result.bytes[2]), 'fixture');
  }
});

test('invalid URLs, modes, malformed wire and pre-abort fail before network dispatch', async () => {
  let calls = 0;
  const fetcher = () => { calls++; throw new Error('must not fetch'); };
  for (const input of ['', 'relative', 'ftp://example.test/', 'https://user:password@example.test/', 'x'.repeat(65537)])
    await assert.rejects(performHttp(input, wire, 'manual', helpers, undefined, fetcher));
  await assert.rejects(performHttp(url, wire, 'unknown', helpers, undefined, fetcher));
  await assert.rejects(performHttp(url, new Uint8Array(), 'manual', helpers, undefined, fetcher));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(performHttp(url, wire, 'manual', helpers, controller.signal, fetcher));
  assert.equal(calls, 0);
});

test('abort cancels a late response stream without buffering it', async () => {
  const controller = new AbortController();
  let cancelled = false;
  await assert.rejects(performHttp(url, wire, 'manual', helpers, controller.signal, async () => {
    controller.abort();
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 }));
  }), error => error.name === 'AbortError');
  assert.equal(cancelled, true);
});

test('shared service codec enforces aggregate request wire budget before fetch', async () => {
  let calls = 0;
  const invoke = async request => {
    calls++;
    assert.equal((await request.arrayBuffer()).byteLength, 1048576 - 16);
    return new Response('ok');
  };
  function postWire(bodyLength, method = 'POST') {
    const bytes = Buffer.alloc(12 + method.length + bodyLength);
    bytes.writeUInt32LE(method.length, 0);
    bytes.write(method, 4);
    bytes.writeUInt32LE(0, 4 + method.length);
    bytes.writeUInt32LE(bodyLength, 8 + method.length);
    return bytes;
  }
  await performHttp(url, postWire(1048576 - 16), 'manual', helpers, undefined, invoke);
  assert.equal(calls, 1);
  for (const bytes of [postWire(1048576 - 15), postWire(0, ''), postWire(0, 'A'.repeat(33))])
    await assert.rejects(performHttp(url, bytes, 'manual', helpers, undefined, invoke));
  assert.equal(calls, 1);
});
