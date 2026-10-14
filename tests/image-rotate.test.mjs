import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRotationPng, performImageRotate } from '../lib/image-rotate.mjs';
import { png } from '../examples/images/test/fixtures.mjs';

// Framed mock bytes only; native integration separately verifies decoded pixels.
const framed = (width = 3, height = 2) => {
  const bytes = Uint8Array.from(png), view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height); return bytes;
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture({ bytes = framed(), alias = true, output, contentType, image } = {}) {
  const events = [], source = {};
  const release = name => function () { events.push(name); };
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  stream[Symbol.dispose] = release('stream');
  const result = { image: image ?? function () { assert.equal(this, result); return stream; },
    contentType: contentType ?? function () { assert.equal(this, result); return 'image/png'; }, [Symbol.dispose]: release('result') };
  const transformed = { output(options) {
    assert.equal(this, transformed); assert.deepEqual(options, { format:'image/png', anim:false });
    const pending = output ? output(result) : Promise.resolve(result);
    pending[Symbol.dispose] = release('pending'); return pending;
  }, [Symbol.dispose]: release('transform') };
  const builder = alias ? transformed : { [Symbol.dispose]: release('input') };
  builder.transform = function (options) { assert.equal(this, builder); assert.deepEqual(options, {rotate:90}); return transformed; };
  const binding = { input(stream) { assert.equal(this, binding); source.stream = stream; return builder; },
    [Symbol.dispose]() { assert.fail('borrowed binding disposed'); } };
  return { binding, builder, transformed, result, stream, source, events };
}

test('PNG preflight rejects bounds, framing, animation and unsupported formats', () => {
  assert.deepEqual(inspectRotationPng(png), {width:2,height:3});
  assert.deepEqual(inspectRotationPng(framed(1024,1024)), {width:1024,height:1024});
  for (const bytes of [new Uint8Array(), new Uint8Array(1048577), framed(0,2), framed(1025,2), png.subarray(0,-1)])
    assert.throws(() => inspectRotationPng(bytes));
  for (const [offset, value] of [[0,0], [24,16], [25,3], [26,1], [27,1], [28,2]]) {
    const bytes = Uint8Array.from(png); bytes[offset] = value; assert.throws(() => inspectRotationPng(bytes));
  }
  const chunk = Buffer.alloc(12); chunk.write('acTL',4);
  assert.throws(() => inspectRotationPng(Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)])), /animated/);
  const padding = Buffer.alloc(12); padding.write('teSt',4);
  assert.throws(() => inspectRotationPng(Buffer.concat([png.subarray(0,33),...Array(1023).fill(padding),png.subarray(33)])), /framing/);
});

test('preflight precedes provider access; input is snapshotted before getters and suspension', async () => {
  const forbidden = { get input() { assert.fail('provider accessed'); } };
  for (const options of ['', '0', '01', '60001', '5\n', 5])
    await assert.rejects(performImageRotate(forbidden, png, options));
  await assert.rejects(performImageRotate(forbidden, new Uint8Array(), '5000'));
  const bytes = Uint8Array.from(png), f = fixture();
  const input = f.binding.input;
  let captured;
  Object.defineProperty(f.binding, 'input', { get() {
    bytes.fill(0);
    return function (stream) { captured = new Response(stream).arrayBuffer(); return input.call(this, stream); };
  } });
  const call = performImageRotate(f.binding, bytes, '5000'); bytes.fill(1);
  await call;
  assert.deepEqual(new Uint8Array(await captured), Uint8Array.from(png));
});

test('owned output and reverse identity-deduplicated cleanup preserve receivers', async () => {
  for (const alias of [true,false]) {
    const bytes = framed(), f = fixture({bytes,alias});
    const result = await performImageRotate(f.binding, png, '5000');
    assert.equal(result.status, 0); assert.deepEqual(result.bytes, bytes); bytes.fill(0); assert.notEqual(result.bytes[0], 0);
    assert.deepEqual(f.events, alias ? ['stream','result','pending','transform'] : ['stream','result','pending','transform','input']);
  }
});

test('wrong output type, dimensions, framing and oversized streams fail closed', async () => {
  for (const options of [{contentType:()=>'image/jpeg'}, {bytes:framed(2,3)}, {bytes:new Uint8Array()}, {bytes:new Uint8Array(1048577)},
    {contentType:()=>Promise.reject(new Error('unexpected asynchronous type'))}]) {
    const f = fixture(options); await assert.rejects(performImageRotate(f.binding, png, '5000'));
    assert(f.events.includes('result')); assert(f.events.includes('stream'));
  }
  await tick();
});

test('cleanup rejects success but preserves primary provider failure', async () => {
  const cleanup = new Error('cleanup'), primary = new Error('provider');
  const f = fixture(); f.builder[Symbol.dispose] = () => { throw cleanup; };
  await assert.rejects(performImageRotate(f.binding, png, '5000'), error => error === cleanup);
  const g = fixture({output:()=>Promise.reject(primary)}); g.builder[Symbol.dispose] = () => { throw cleanup; };
  await assert.rejects(performImageRotate(g.binding, png, '5000'), error => error === primary);
});

test('deadline returns promptly; late output is acquired once and canceled without waiting', async () => {
  let resolve, calls = 0, canceled = 0;
  const stream = new ReadableStream({ cancel() { canceled++; return new Promise(()=>{}); } });
  const f = fixture({output:()=>new Promise(r=>{resolve=r;}), image:()=>{calls++;return stream;}});
  await assert.rejects(performImageRotate(f.binding, png, '5'), {name:'TimeoutError'});
  resolve(f.result); await tick();
  assert.equal(calls, 1); assert.equal(canceled, 1); assert(f.events.includes('result'));
});

test('abort from image accessor is reentrant-safe and cancels its returned stream', async () => {
  const controller = new AbortController(), reason = new Error('abort'); let calls = 0, canceled = 0;
  const stream = new ReadableStream({cancel(){canceled++;}});
  const f = fixture({image(){calls++;controller.abort(reason);return stream;}});
  await assert.rejects(performImageRotate(f.binding, png, '5000', controller.signal), error=>error===reason);
  assert.equal(calls, 1); assert.equal(canceled, 1);
});

test('active output reader cancellation and late rejection preserve abort reason', async () => {
  const controller = new AbortController(), reason = new Error('stopped'); let canceled = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const stream = new ReadableStream({pull(){started();},cancel(){canceled++;return new Promise(()=>{});}});
  const f = fixture({image:()=>stream});
  const pending = performImageRotate(f.binding, png, '5000', controller.signal);
  await ready; await tick(); controller.abort(reason);
  await assert.rejects(pending, error=>error===reason); assert.equal(canceled, 1);
  let reject;
  const g = fixture({output:()=>new Promise((_,r)=>{reject=r;})});
  await assert.rejects(performImageRotate(g.binding, png, '5'), {name:'TimeoutError'});
  reject(new Error('late provider rejection')); await tick();
  await performImageRotate(fixture().binding, png, '5000');
});

test('abort during transform method lookup prevents invocation', async () => {
  const controller = new AbortController(), reason = new Error('lookup abort'), f = fixture();
  Object.defineProperty(f.builder, 'transform', {get(){controller.abort(reason); return ()=>assert.fail('transform after abort');}});
  await assert.rejects(performImageRotate(f.binding, png, '5000', controller.signal), error=>error===reason);
  assert.deepEqual(f.events, ['transform']);
});

test('synchronous aborting output still cancels its late identified result body', async () => {
  const controller = new AbortController(), reason = new Error('output abort'); let canceled = 0;
  const stream = new ReadableStream({cancel(){canceled++;}}), f = fixture({image:()=>stream});
  f.transformed.output = () => {controller.abort(reason);return f.result;};
  await assert.rejects(performImageRotate(f.binding, png, '5000', controller.signal), error=>error===reason);
  await tick(); assert.equal(canceled, 1);
});

test('late malformed asynchronous image accessor rejection is drained', async () => {
  let resolve;
  const f = fixture({output:()=>new Promise(r=>{resolve=r;}), image:()=>Promise.reject(new Error('invalid image promise'))});
  await assert.rejects(performImageRotate(f.binding, png, '5'), {name:'TimeoutError'});
  resolve(f.result); await tick(); await tick();
});
