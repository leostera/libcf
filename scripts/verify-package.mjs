import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { inspectSdk } from './sdk-archive.mjs';

const execute = promisify(execFile);
const [unpacker, bazel, ...extra] = process.argv.slice(2);
if (!bazel || !isAbsolute(bazel) || extra.length) throw new Error('Pass an absolute official Bazel 9.3.0 executable path');
assert.equal((await execute(bazel, ['--version'])).stdout.trim(), 'bazel 9.3.0');
const root = await mkdtemp(resolve(tmpdir(), 'libcf-package-consumer-'));
const consumer = resolve(root, 'consumer');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(?:RUNFILES_|JS_BINARY__|BAZEL_)/.test(key) || ['CPATH', 'CPLUS_INCLUDE_PATH', 'C_INCLUDE_PATH'].includes(key)) delete env[key];
}
async function runBazel(args) {
  const result = await execute(bazel, ['--batch', `--output_base=${root}/output`, ...args, '--repo_env=DO_NOT_TRACK=1'], {
    cwd: consumer, env, timeout: 300000, maxBuffer: 8388608,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

async function exerciseWorker(sdk) {
  const factory = resolve(consumer, 'bazel-bin/build/consumer_worker.mjs');
  const runtimeModule = resolve(sdk, 'lib/runtime.mjs');
  await Promise.all([readFile(factory), readFile(runtimeModule)]);
  const output = await build({
    stdin: { resolveDir: consumer, contents: `
      import factory from ${JSON.stringify(factory)};
      import wasm from './consumer.wasm';
      import { createWorker } from ${JSON.stringify(runtimeModule)};
      export default createWorker(factory, wasm);
    ` },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    external: ['*.wasm', 'cloudflare:*'],
  });
  const runtime = new Miniflare({ host: '127.0.0.1', port: 0, workers: [{ config: {
    name: 'external-consumer', compatibilityDate: '2026-10-13', env: {}, exports: {},
    manifest: { mainModule: 'worker.mjs', modulesRoot: '/libcf-external-consumer', modules: {
      'worker.mjs': { type: 'esm', contents: output.outputFiles[0].text },
      'consumer.wasm': { type: 'wasm', contents: await readFile(resolve(consumer, 'bazel-bin/build/consumer_worker.wasm')) },
    } },
  } }] });
  try {
    const response = await runtime.dispatchFetch('https://example.test/', { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'external package works');
  } finally { await runtime.dispose(); }
}

try {
  const original = resolve(root, 'original package');
  const relocated = resolve(root, 'relocated package');
  await mkdir(original);
  await copyFile('cf-0.1.0.tar.gz', resolve(original, 'cf.tar.gz'));
  await rename(original, relocated);
  const archive = resolve(relocated, 'cf.tar.gz');
  const { sdk, files } = await inspectSdk(unpacker, archive, relocated);
  const integrity = `sha256-${createHash('sha256').update(await readFile(archive)).digest('base64')}`;
  await mkdir(consumer);
  for (const file of ['main.cpp', 'all_headers.cpp', 'consumer-worker.cpp']) {
    await copyFile(`tests/package/${file}`, resolve(consumer, file));
  }
  await copyFile('tests/package/BUILD.consumer', resolve(consumer, 'BUILD.bazel'));
  await writeFile(resolve(consumer, '.bazelversion'), '9.3.0\n');
  await writeFile(resolve(consumer, 'MODULE.bazel'), `
module(name = "cf_consumer")
bazel_dep(name = "cf", version = "0.1.0")
bazel_dep(name = "rules_cc", version = "0.2.26")
archive_override(
    module_name = "cf",
    urls = [${JSON.stringify(pathToFileURL(archive).href)}],
    integrity = ${JSON.stringify(integrity)},
    strip_prefix = "cf-0.1.0",
)
`);
  // There is no project .bazelrc or source checkout in the consumer workspace.
  await runBazel(['test', '//...']);
  await runBazel(['test', '--lockfile_mode=error', '//...']);
  await exerciseWorker(sdk);
  console.log(JSON.stringify({ sdkFiles: files.length, archiveIntegrity: integrity,
    nativeStandards: [20, 23], workerStandard: 23, externalWorkerExecuted: true,
    relocatedArchive: true, cmakeUsed: false }));
} finally { await rm(root, { recursive: true, force: true }); }
