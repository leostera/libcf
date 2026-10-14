import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { png, svg, chunk } from './fixtures.mjs';
import { decodeTinyPng, rotatedPixels } from './png-decode.mjs';
let worker, root, modules;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'libcf-images-cpp-'));
  const directory = 'bundles/images';
  const inventory = JSON.parse(await readFile(`${directory}/bundle.json`, 'utf8'));
  assert.equal(inventory.schemaVersion, 2); assert.deepEqual(inventory.requiredTextModules, []); assert.equal(inventory.wasmModules.length, 1);
  modules = { 'worker.mjs': { type:'esm', contents:await readFile(`${directory}/worker.mjs`, 'utf8') } };
  for (const file of inventory.wasmModules) modules[file] = { type:'wasm', contents:await readFile(`${directory}/${file}`) };
  worker = new Miniflare({ host:'127.0.0.1', port:0, resourcePersistencePath:root, unsafeEnableSharedStorage:false, workers:[{config:{
    name:'images-cpp', compatibilityDate:'2026-10-13', env:{IMAGES:{type:'images'},LIBCF_IMAGES_LOCAL_ROTATION:{type:'text',value:'enabled'}},
    manifest:{mainModule:'worker.mjs',modulesRoot:join(root,'modules'),modules},
  }}] });
});
after(async () => { try { await worker?.dispose(); } finally { if (root) await rm(root,{recursive:true,force:true}); } });
const post = (body, path) => worker.dispatchFetch(`https://example.test${path}`, {method:'POST',body,signal:AbortSignal.timeout(10000)});
async function info(body, path = '/info') {
  const response = await post(body, path);
  return { status: response.status, text: await response.text() };
}
async function rotation(body = png) {
  const response = await post(body, '/rotate'); assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(decodeTinyPng(Buffer.from(await response.arrayBuffer())), rotatedPixels);
}
test('same emitted bundle disables rotation without the explicit local fixture flag', async () => {
  const disabled = new Miniflare({host:'127.0.0.1',port:0,resourcePersistencePath:join(root,'disabled'),unsafeEnableSharedStorage:false,workers:[{config:{
    name:'images-disabled',compatibilityDate:'2026-10-13',env:{IMAGES:{type:'images'}},
    manifest:{mainModule:'worker.mjs',modulesRoot:join(root,'disabled-modules'),modules},
  }}]});
  try {
    const response = await disabled.dispatchFetch('https://example.test/rotate',{method:'POST',body:png,signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,403); assert.equal(await response.text(),'rotation disabled');
  } finally { await disabled.dispose(); }
});
test('emitted C++ Images bundle reports native PNG/SVG metadata', async () => {
  assert.deepEqual(await info(png), {status:200,text:`image/png 2x3 ${png.length}`});
  assert.deepEqual(await info(svg), {status:200,text:'image/svg+xml'});
});
test('invalid/empty images, missing binding and oversize fail with recovery', async () => {
  for (const body of ['', 'not an image']) assert.equal((await info(body)).status, 502);
  assert.equal((await info(png, '/missing')).status, 502);
  assert.equal((await info('', '/oversized')).status, 502);
  assert.equal((await info(png)).status, 200);
});
test('emitted C++ rotation has correct native pixels, exact input cap and concurrent isolation', async () => {
  await rotation();
  const maximum = Buffer.concat([png.subarray(0,33),chunk('teSt',Buffer.alloc(1048576-png.length-12)),png.subarray(33)]);
  assert.equal(maximum.length,1048576); await rotation(maximum);
  await Promise.all(Array.from({length:8},()=>rotation()));
});
test('rotation rejects unsupported input and missing provider, then recovers', async () => {
  const oversizedDimension = Buffer.from(png); oversizedDimension.writeUInt32BE(1025,16);
  const animated = Buffer.concat([png.subarray(0,33),chunk('acTL',Buffer.alloc(8)),png.subarray(33)]);
  for (const body of ['',svg,'not an image',oversizedDimension,animated,png.subarray(0,-1)]) {
    const response = await post(body,'/rotate'); assert.equal(response.status,502); assert.equal(await response.text(),'image rotation failed');
  }
  for (const path of ['/rotate-missing','/rotate-oversized']) {
    const response = await post(png,path); assert.equal(response.status,502); assert.equal(await response.text(),'image rotation failed');
  }
  await rotation();
});
