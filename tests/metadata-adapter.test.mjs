import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performVersionMetadata, performSecretsStore } from '../lib/metadata.mjs';

test('version metadata requires owned strings and a bounded wire', () => {
  const result = performVersionMetadata({ id: 'id', tag: '', timestamp: '2026-10-13T12:00:00Z' });
  assert.equal(result.status, 0);
  assert.equal(new DataView(result.bytes.buffer).getUint32(0, true), 2);
  for (const invalid of [{}, { id: 'id', tag: 0, timestamp: 'now' }, { id: '', tag: '', timestamp: 'now' },
    { id: 'id', tag: 'x'.repeat(65536), timestamp: 'now' }])
    assert.throws(() => performVersionMetadata(invalid));
});

test('secret reads preserve empty/UTF-8 values but redact provider errors', async () => {
  assert.equal((await performSecretsStore({ async get() { return ''; } })).bytes.length, 0);
  const bytes = (await performSecretsStore({ async get() { return 'fixture-☁'; } })).bytes;
  assert.equal(new TextDecoder().decode(bytes), 'fixture-☁');
  await assert.rejects(performSecretsStore({ async get() { throw new Error('synthetic-private-value'); } }), error =>
    error.message === 'Secrets Store read failed' && !error.message.includes('synthetic-private-value'));
  await assert.rejects(performSecretsStore({ async get() { return null; } }), /invalid/);
  assert.equal((await performSecretsStore({ async get() { return 'x'.repeat(65536); } })).bytes.length, 65536);
  await assert.rejects(performSecretsStore({ async get() { return 'x'.repeat(65537); } }), /exceeds/);
  await assert.rejects(performSecretsStore({ async get() { return '☁'.repeat(21846); } }), /exceeds/);
});
