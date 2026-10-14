import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execute = promisify(execFile);

export async function inspectSdk(unpacker, archive, destination) {
  const output = await execute(resolve(unpacker), [resolve(archive), destination], {
    timeout: 30000, maxBuffer: 1048576,
  });
  const files = JSON.parse(output.stdout);
  const sdk = resolve(destination, 'cf-0.1.0');
  const allHeaders = (await readdir('include', { recursive: true }))
    .filter(name => name.endsWith('.hpp')).map(name => `include/${name}`).sort();
  assert.deepEqual(files.filter(name => name.startsWith('include/')), allHeaders);
  const headers = (await readdir('include/cf')).filter(name => name.endsWith('.hpp')).sort();
  const installedHeaders = (await readdir(`${sdk}/include/cf`)).filter(name => name.endsWith('.hpp')).sort();
  assert.deepEqual(installedHeaders, headers);
  const consumer = await readFile('tests/package/all_headers.cpp', 'utf8');
  for (const name of headers) assert(consumer.includes(`#include <cf/${name}>`), `consumer missing ${name}`);
  const modules = (await readdir('lib')).filter(name => /\.(mjs|js)$/.test(name)).sort();
  assert.deepEqual((await readdir(`${sdk}/lib`)).sort(), modules);
  for (const file of files) {
    assert(!/cmake/i.test(file), `CMake file in SDK: ${file}`);
    assert(!/^(?:build|bazel-|node_modules|\.git|\.pi|tests|examples)(?:\/|$)/.test(file), file);
    if (file.startsWith('include/') || file.startsWith('lib/') || file === 'src/worker.cpp') {
      assert.deepEqual(await readFile(`${sdk}/${file}`), await readFile(file), file);
    }
  }
  await build({
    entryPoints: modules.filter(name => name.endsWith('.mjs')).map(name => `${sdk}/lib/${name}`),
    outdir: `${destination}/adapter-check`, bundle: true, write: false,
    format: 'esm', platform: 'browser', external: ['cloudflare:*'],
  });
  return { sdk, files };
}
