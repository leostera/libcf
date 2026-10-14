import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execute = promisify(execFile);

async function probe(advancing) {
  const root = await mkdtemp(join(tmpdir(), 'libcf-clock-policy-'));
  try {
    await writeFile(join(root, 'probe.mjs'), await readFile('scripts/test-live-clock.mjs'));
    await writeFile(join(root, 'live-http.mjs'), `
export async function awaitCertificate() {}
export function liveHttp() {
  return async path => {
    const now = Date.now();
    const count = path === '/same-turn' ? 33 : path === '/after-sleep' ? 2 : 1;
    const values = Array.from({ length: count }, (_, index) =>
      now + (process.env.MOCK_ADVANCING_CLOCK === '1' && index > 0 ? 1 : 0));
    return new Response(values.join(' '), { headers: {
      'x-js-clock-before': String(now), 'x-js-clock-after': String(now + 1),
    } });
  };
}
`);
    return await execute(process.execPath, [join(root, 'probe.mjs'), 'mock'], {
      env: { ...process.env, MOCK_ADVANCING_CLOCK: advancing ? '1' : '0' }, timeout: 10000,
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('live clock policy accepts all 33 frozen samples', async () => {
  const { stdout } = await probe(false);
  assert(JSON.parse(stdout).passed.includes('same-turn frozen clock'));
});

test('live clock policy rejects advancing samples even inside the JS bracket', async () => {
  await assert.rejects(probe(true), error => /production clock changed without I\/O/.test(error.stderr));
});
