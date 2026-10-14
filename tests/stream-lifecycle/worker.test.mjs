import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const totalBytes = 128 * 65536;
function parseStats(text) {
  const values = text.split(' ').map(Number);
  assert.equal(values.length,6); assert(values.every(Number.isSafeInteger));
  const [cpp,pulls,chunks,released,active,sessions] = values;
  return {cpp,pulls,chunks,released,active,sessions};
}
test('emitted C++23 stream source owns its capture and releases on cancel/EOF', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'libcf-stream-lifecycle-')); let runtime;
  try {
    const directory = 'bundles/stream-lifecycle-probe';
    const inventory = JSON.parse(await readFile(`${directory}/bundle.json`,'utf8'));
    assert.equal(inventory.schemaVersion,2); assert.deepEqual(inventory.requiredTextModules,[]); assert.equal(inventory.wasmModules.length,1);
    const modules = {'worker.mjs':{type:'esm',contents:await readFile(`${directory}/worker.mjs`,'utf8')}};
    for (const file of inventory.wasmModules) modules[file] = {type:'wasm',contents:await readFile(`${directory}/${file}`)};
    runtime = new Miniflare({host:'127.0.0.1',port:0,workers:[{dev:{unsafeDirectSockets:[{host:'127.0.0.1',port:0}]},config:{name:'stream-lifecycle-probe',compatibilityDate:'2026-10-13',compatibilityFlags:['enable_request_signal'],
      manifest:{mainModule:'worker.mjs',modulesRoot:join(root,'modules'),modules},
    }}]});
    const base = await runtime.unsafeGetDirectURL('stream-lifecycle-probe');
    const get = path => fetch(new URL(path,base),{signal:AbortSignal.timeout(10000)});
    const stats = async () => parseStats(await (await get('/stats')).text());
    const inspected = await get('/inspect'); assert.equal(inspected.status,200);
    const trace = await inspected.json();
    assert(trace.before.cpp >= 202302); assert.equal(trace.before.active,0);
    assert.equal(trace.opened.active,1); assert.equal(trace.opened.chunks,1);
    assert.deepEqual(trace.first,{done:false,length:65536,zero:true});
    assert.deepEqual(trace.second,{done:false,length:65536,one:true}); assert.equal(trace.retainedZero,true);
    assert(trace.consumed.chunks >= 2 && trace.consumed.chunks <= 3); assert.equal(trace.consumed.active,1);
    assert.equal(trace.after.active,0); assert.equal(trace.after.released,trace.before.released+1);

    // Actual owned loopback HTTP: observe, rather than assume, how far the
    // producer advances while Node has not requested body reads. An 8 MiB
    // finite fixture cannot establish a universal transport buffering bound.
    const before = await stats(), response = await get('/stream'); assert.equal(response.status,200);
    const paused = await stats(); await delay(100); const later = await stats();
    const reader = response.body.getReader(); let received = 0;
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        assert(received + value.length <= totalBytes);
        assert(value.every((byte,index)=>byte===(((received+index)>>>16)%251)), 'chunk ownership or ordering changed');
        received += value.length;
      }
    } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
    assert.equal(received,totalBytes);
    const after = await stats(); assert.equal(after.active,0); assert.equal(after.chunks,128); assert.equal(after.pulls,129); assert.equal(after.released,before.released+1);
    assert(paused.chunks <= later.chunks && later.chunks <= 128);
    console.log(JSON.stringify({cpp:after.cpp,chunkBytes:65536,maximumBytes:totalBytes,pausedChunks:paused.chunks,after100msChunks:later.chunks,received,released:after.released-before.released}));
    const beforeCancel = await stats(), interrupted = await get('/stream'); assert.equal(interrupted.status,200);
    const atCancel = await stats(); await interrupted.body.cancel('owned HTTP consumer stopped');
    const deadline = performance.now() + 2000; let canceled = await stats();
    while (canceled.active && performance.now() < deadline) { await delay(20); canceled = await stats(); }
    console.log(JSON.stringify({cancelDiagnostic:{atCancel,canceled,signal:await (await get('/signal-stats')).json()}}));
    assert.equal(canceled.active,0,'native source release not observed within the local budget');
    assert.equal(canceled.released,beforeCancel.released+1);
    console.log(JSON.stringify({httpCancel:{chunksAtCancel:atCancel.chunks,chunksAtRelease:canceled.chunks,activeAtCancel:atCancel.active,released:canceled.released-beforeCancel.released}}));
    // If the finite source had already reached EOF, release is not attributed to
    // cancellation. The counters preserve that distinction on other platforms.
    const recovery = await get('/inspect'); assert.equal(recovery.status,200); assert.equal((await recovery.json()).after.active,0);
  } finally { try { await runtime?.dispose(); } finally { await rm(root,{recursive:true,force:true}); } }
});
