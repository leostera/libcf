import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';

const documentUrl = new URL('../docs/binding-operations.md', import.meta.url);
test('binding-operation ledger exactly matches the explicit versioned enum and fixture files', async () => {
  const header = await readFile(new URL('../include/cf/operation.hpp', import.meta.url), 'utf8');
  const body = /enum\s+class\s+Operation\s*:\s*std::uint32_t\s*\{([\s\S]*?)\};/.exec(header)?.[1];
  assert(body, 'expected the uint32_t operation enum');
  const operations = body.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//')).map(line => {
    const entry = /^(\w+)\s*=\s*(\d+)\s*,?$/.exec(line);
    assert(entry, `operation IDs must remain explicit: ${line}`);
    const id = Number(entry[2]);
    assert(Number.isInteger(id) && id >= 0 && id <= 0xffffffff);
    return [id, entry[1]];
  });
  const document = await readFile(documentUrl, 'utf8');
  const rows = [...document.matchAll(/^\|\s*(\d+)\s*\|\s*`(\w+)`\s*\|([^\n]+)$/gm)];
  const ledger = rows.map(row => [Number(row[1]), row[2]]);
  for (const entries of [operations, ledger]) {
    assert.equal(new Set(entries.map(([id]) => id)).size, entries.length, 'duplicate ID');
    assert.equal(new Set(entries.map(([, name]) => name)).size, entries.length, 'duplicate name');
  }
  assert.deepEqual(ledger.sort(([a], [b]) => a - b), operations.sort(([a], [b]) => a - b));
  for (const row of rows) {
    const fixture = /\]\((\.\.\/examples\/[^)]+)\)/.exec(row[3])?.[1];
    assert(fixture, `missing fixture for ${row[2]}`);
    assert((await stat(new URL(fixture, documentUrl))).isFile(), fixture);
    assert.match(row[3], /\|\s*(?:L|A|M)\s*\|\s*(?:V|Pending|Approval)\s*\|/);
  }
});
