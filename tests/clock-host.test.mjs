import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
test('synchronous clock import reads the platform on every call, without truncating to i32', async () => {
  let library, calls = 0;
  let value = 1791912345678;
  runInNewContext(await readFile(new URL('../lib/emscripten-host.js', import.meta.url), 'utf8'), {
    addToLibrary(value) { library = value; }, Date: { now() { calls++; return value; } },
  });
  assert.equal(library.libcf_host_now(), value);
  value = -8640000000000000;
  assert.equal(library.libcf_host_now(), value);
  assert.equal(calls, 2);
});
