import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Restrict build targets to known examples rather than interpreting arbitrary
// config paths as compiler inputs.
const targets = {
  'examples/core/wrangler.jsonc': 'core',
  'examples/kv/wrangler.jsonc': 'kv',
  'examples/d1/wrangler.jsonc': 'd1',
  'examples/r2/wrangler.jsonc': 'r2',
  'examples/cache/wrangler.jsonc': 'cache',
  'examples/service/wrangler.jsonc': 'service',
  'examples/durable/wrangler.jsonc': 'durable',
  'examples/events/wrangler.jsonc': 'events',
  'examples/websocket/wrangler.jsonc': 'websocket',
  'examples/email/wrangler.jsonc': 'email',
  'examples/rate-limit/wrangler.jsonc': 'rate-limit',
  'examples/analytics/wrangler.jsonc': 'analytics',
  'examples/metadata/wrangler.jsonc': 'metadata',
  'examples/worker-loader/wrangler.jsonc': 'worker-loader',
  'examples/crypto/wrangler.jsonc': 'crypto',
  'examples/benchmark/wrangler.jsonc': 'benchmark',
  'examples/http-client/wrangler.jsonc': 'http-client',
  'examples/pipeline/wrangler.jsonc': 'pipeline',
  'examples/timer/wrangler.jsonc': 'timer',
  'examples/workflow/wrangler.jsonc': 'workflow',
  'examples/durable/object': 'durable-object',
};
const config = process.argv[2] ?? 'examples/core/wrangler.jsonc';
const target = targets[config];
if (!target) throw new Error(`Unknown example configuration: ${config}`);

const toolchain = spawnSync('em++', ['--version'], { encoding: 'utf8' });
if (toolchain.error) throw toolchain.error;
if (toolchain.status !== 0 || !toolchain.stdout.includes('6.0.12')) {
  throw new Error(`Core example requires Emscripten 6.0.12; found: ${toolchain.stdout || toolchain.stderr}`);
}
mkdirSync('build', { recursive: true });
const args = [
  'src/worker.cpp', target === 'durable-object' ? 'examples/durable/src/object.cpp' : `examples/${target}/src/main.cpp`, '-Iinclude', '-std=c++20', '-O2',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web',
  '-sWASM_ASYNC_COMPILATION=1', '-sALLOW_MEMORY_GROWTH=1',
  '-sFILESYSTEM=0',
  '-sEXPORTED_FUNCTIONS=["_libcf_http","_libcf_fetch_done","_libcf_cancel","_libcf_stream_pull","_libcf_stream_cancel","_libcf_operation_done","_malloc","_free"]',
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]',
  '--js-library', 'lib/emscripten-host.js',
  '-o', `build/${target}.mjs`,
];
const result = spawnSync('em++', args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
