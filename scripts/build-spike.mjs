import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const toolchain = spawnSync('em++', ['--version'], { encoding: 'utf8' });
if (toolchain.error) throw toolchain.error;
if (toolchain.status !== 0 || !toolchain.stdout.includes('6.0.12')) {
  throw new Error(`Spike requires Emscripten 6.0.12; found: ${toolchain.stdout || toolchain.stderr}`);
}
mkdirSync('build', { recursive: true });
const args = [
  'examples/hello/src/spike.cpp', '-std=c++20', '-O2',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web',
  '-sWASM_ASYNC_COMPILATION=1', '-sALLOW_MEMORY_GROWTH=1',
  '-sFILESYSTEM=0',
  '-sEXPORTED_FUNCTIONS=["_cf_add","_cf_get","_cf_fetch_asset","_cf_resume","_cf_background_write","_cf_stream_chunk","_malloc","_free"]',
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]',
  '--js-library', 'examples/hello/src/host.js',
  '-o', 'build/spike.mjs',
];
const result = spawnSync('em++', args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
