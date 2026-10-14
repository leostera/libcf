import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performQueue } from '../lib/queue.mjs';

function batchWire(messages) {
  const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  return Buffer.concat([u32(messages.length), ...messages.flatMap(message => {
    const bytes = typeof message === 'string' ? Buffer.from(message) : message;
    return [u32(bytes.length),bytes];
  })]);
}

test('Queue text batch is wholly owned before the one provider call', async () => {
  for (const messages of [['', '\uFEFFhello', 'abc'], Array.from({length:100},(_,i)=>String(i)),
    ['x'.repeat(127994), 'y'.repeat(127994)]]) {
    const wire = batchWire(messages);
    let calls = 0;
    const queue = {get sendBatch() {
      wire.fill(90);
      return function(batch, options) {
        assert.equal(this,queue); calls++;
        assert.deepEqual(batch,messages.map(body=>({body,contentType:'text'})));
        assert.deepEqual(options,{delaySeconds:86400});
      };
    }};
    assert.deepEqual(await performQueue(114,queue,wire,'86400'),{status:0,bytes:new Uint8Array()});
    assert.equal(calls,1);
  }
});

test('Queue batch rejects all malformed frames before provider access', async () => {
  let accesses = 0;
  const queue = {get sendBatch() { accesses++; throw new Error('must not access'); }};
  const frame = batchWire(['ok']);
  const badCount = Buffer.from(frame); badCount.writeUInt32LE(0xffffffff,0);
  const badLength = Buffer.from(frame); badLength.writeUInt32LE(0xffffffff,4);
  const cases = [batchWire([]),batchWire(Array(101).fill('')),batchWire(['x'.repeat(128000)]),
    batchWire(['x'.repeat(127995),'y'.repeat(127994)]),batchWire([Uint8Array.of(255)]),batchWire(['ok','a\0b']),
    badCount,badLength,Buffer.concat([frame,Buffer.from([0])])];
  for (let size=0;size<frame.length;size++) cases.push(frame.subarray(0,size));
  for (const bytes of cases) await assert.rejects(performQueue(114,queue,bytes,'0'));
  for (const delay of ['-1','86401']) await assert.rejects(performQueue(114,queue,frame,delay));
  assert.equal(accesses,0);
});

test('Queue batch observes late provider rejection without retries', async () => {
  let calls = 0, reject;
  const failure = new Error('acceptance unknown');
  const pending = performQueue(114,{sendBatch() { calls++; return new Promise((_,fail)=>{reject=fail;}); }},batchWire(['one','two']),'0');
  reject(failure);
  await assert.rejects(pending,error=>error===failure);
  assert.equal(calls,1);
});

test('Queue producer uses a decimal 128-KB exclusive body boundary', async () => {
  for (const method of [112, 113]) {
    let calls = 0;
    const queue = { async send(body, options) {
      calls++;
      assert.equal(body.length, 127_999);
      assert.equal(options.contentType, method === 112 ? 'text' : 'bytes');
      assert.equal(options.delaySeconds, 86400);
    } };
    const accepted = new Uint8Array(127_999).fill(65);
    assert.deepEqual(await performQueue(method, queue, accepted, '86400'), {
      status: 0, bytes: new Uint8Array(),
    });
    for (const length of [128_000, 128 * 1024]) {
      await assert.rejects(performQueue(method, queue, new Uint8Array(length), '0'), /payload/);
    }
    assert.equal(calls, 1);
  }
});

test('Queue rejects invalid delays, UTF-8 and operations before calling a binding', async () => {
  let calls = 0;
  const queue = { async send() { calls++; } };
  for (const delay of ['', '-1', '0.5', '86401', '9007199254740992', 'Infinity']) {
    await assert.rejects(performQueue(113, queue, Uint8Array.of(1), delay));
  }
  await assert.rejects(performQueue(112, queue, Uint8Array.of(255), '0'), /encoded data/);
  await assert.rejects(performQueue(112, queue, new TextEncoder().encode('é'.repeat(64_000)), '0'), /payload/);
  await assert.rejects(performQueue(999, queue, Uint8Array.of(1), '0'), /unknown Queue/);
  assert.equal(calls, 0, 'invalid input must not invoke a binding');
});

test('Queue byte payload is owned before awaiting the binding', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let captured;
  const input = Uint8Array.of(0, 255, 128, 65);
  const result = performQueue(113, { async send(body, options) {
    captured = body;
    assert.deepEqual(options, { contentType: 'bytes', delaySeconds: 0 });
    await pending;
  } }, input, '0');
  input.fill(7);
  assert.deepEqual(captured, Uint8Array.of(0, 255, 128, 65));
  release();
  await result;
});

test('Queue text preserves leading Unicode BOM code points', async () => {
  for (const text of ['\uFEFF', '\uFEFFhello', '\uFEFF\uFEFFhello']) {
    let captured;
    await performQueue(112, { send(value) { captured = value; } }, new TextEncoder().encode(text), '0');
    assert.equal(captured, text);
  }
});

test('Queue snapshots text and bytes before accessing the send method', async () => {
  for (const method of [112, 113]) {
    const input = Uint8Array.of(65, 66);
    let captured;
    const queue = { get send() {
      input.fill(90);
      return function(value) { assert.equal(this, queue); captured = value; };
    } };
    await performQueue(method, queue, input, '0');
    assert.deepEqual(captured, method === 112 ? 'AB' : Uint8Array.of(65, 66));
  }
  let accessed = false;
  await assert.rejects(performQueue(112, { get send() { accessed = true; } }, Uint8Array.of(255), '0'));
  assert.equal(accessed, false, 'invalid text must fail before provider method access');
});

test('Queue propagates ambiguous provider failure without retrying', async () => {
  let calls = 0;
  const failure = new Error('provider failure');
  await assert.rejects(performQueue(112, { async send() { calls++; throw failure; } },
    new TextEncoder().encode('hello'), '0'), error => error === failure);
  assert.equal(calls, 1);
});
