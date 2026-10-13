import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rename, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { build } from 'esbuild';
const execute = promisify(execFile);
const run = args => execute('cmake', args, { timeout: 120000, maxBuffer: 1048576 });

test('relocated custom-layout package supports all headers and installed JS adapters', { timeout: 180000 }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'libcf-installed package-'));
  const original = `${root}/original`;
  const relocated = `${root}/relocated`;
  try {
    const headers = (await readdir('include/cf')).filter(name => name.endsWith('.hpp')).sort();
    const consumer = await readFile('tests/package/all_headers.cpp', 'utf8');
    for (const name of headers) assert(consumer.includes(`#include <cf/${name}>`), `consumer missing ${name}`);
    await run(['-S', '.', '-B', `${root}/library`, '-DBUILD_TESTING=OFF', `-DCMAKE_INSTALL_PREFIX=${original}`,
      '-DCMAKE_INSTALL_INCLUDEDIR=custom/include', '-DCMAKE_INSTALL_DATADIR=custom/share', '-DCMAKE_INSTALL_LIBDIR=custom/lib']);
    await run(['--install', `${root}/library`]);
    await rename(original, relocated);
    await run(['-S', 'tests/package', '-B', `${root}/consumer`, `-Dcf_DIR=${relocated}/custom/lib/cmake/cf`,
      '-DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF', '-DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF']);
    await run(['--build', `${root}/consumer`, '--config', 'Debug', '--parallel', '2']);
    await execute('ctest', ['--test-dir', `${root}/consumer`, '-C', 'Debug', '--output-on-failure'], { timeout: 30000 });
    const normalize = path => path.replaceAll('\\', '/').trim();
    assert.deepEqual((await readFile(`${root}/consumer/package-paths.txt`, 'utf8')).trim().split('\n').map(normalize), [
      `${relocated}/custom/include`, `${relocated}/custom/share/cf`, `${relocated}/custom/share/cf/src/worker.cpp`,
    ].map(normalize));
    assert.deepEqual((await readdir(`${relocated}/custom/include/cf`)).filter(name => name.endsWith('.hpp')).sort(), headers);
    const runtime = `${relocated}/custom/share/cf`;
    const modules = (await readdir('lib')).filter(name => /\.(mjs|js)$/.test(name)).sort();
    assert.deepEqual((await readdir(runtime)).filter(name => /\.(mjs|js)$/.test(name)).sort(), modules);
    for (const name of modules) assert.deepEqual(await readFile(`${runtime}/${name}`), await readFile(`lib/${name}`));
    const options = { bundle: true, write: false, format: 'esm', platform: 'browser',
      external: ['cloudflare:*'], outdir: `${root}/bundled`, logLevel: 'silent' };
    await build({ ...options, entryPoints: modules.filter(name => name.endsWith('.mjs')).map(name => `${runtime}/${name}`) });
    // Prove this is resolving installed files rather than silently falling back
    // to the source checkout or a previously installed package.
    await unlink(`${runtime}/subtle-crypto.mjs`);
    await assert.rejects(build({ ...options, entryPoints: [`${runtime}/runtime.mjs`] }), /subtle-crypto/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
