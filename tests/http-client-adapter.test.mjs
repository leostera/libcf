import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performHttp } from '../lib/http-client.mjs';
import { readBounded } from '../lib/body.mjs';
import { encodeHeaders } from '../lib/header-wire.mjs';
const wire = new Uint8Array(Buffer.from('030000004745540000000000000000', 'hex'));
const helpers = { readBounded, encodeHeaders, encodeFields: fields => fields };
const url = 'https://upstream.libcf.leostera.dev/';

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
