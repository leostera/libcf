import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const toolchain = spawnSync('em++', ['--version'], { encoding: 'utf8' });
if (toolchain.error) throw toolchain.error;
if (toolchain.status !== 0 || !toolchain.stdout.includes('6.0.12')) {
  throw new Error(`Core example requires Emscripten 6.0.12; found: ${toolchain.stdout || toolchain.stderr}`);
}
mkdirSync('build', { recursive: true });
const args = [
  'examples/core/src/main.cpp', '-Iinclude', '-std=c++20', '-O2',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web',
  '-sWASM_ASYNC_COMPILATION=1', '-sALLOW_MEMORY_GROWTH=1',
  '-sFILESYSTEM=0',
  '-sEXPORTED_FUNCTIONS=["_libcf_http","_libcf_fetch_done","_libcf_cancel","_libcf_stream_pull","_libcf_stream_cancel","_malloc","_free"]',
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]',
  '--js-library', 'lib/emscripten-host.js',
  '-o', 'build/core.mjs',
];
const result = spawnSync('em++', args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
