import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';

const auditUrl = new URL('../docs/inventory-audit.md', import.meta.url);
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const sortedUnique = (values, label) => {
  assert(values.length > 0, `${label}: expected entries`);
  assert.equal(new Set(values).size, values.length, `${label}: duplicate entries`);
  return [...values].sort();
};
const capabilityIds = text => [...text.matchAll(/^\|\s*([A-Z]\d{2})\s*\|/gm)]
  .map(match => match[1]).filter(id => !id.startsWith('F'));
const tracks = text => [...text.matchAll(/^\|([^|]*\*\*[RPX]\*\*[^|]*)\|([^\n]+)$/gm)]
  .map(match => ({ name: match[1].trim().replace(/\s+/g, ' '), cells: match[2] }));

test('audit accounts for every foundation, capability and inventory track without inventing IDs', async () => {
  const [audit, coverage, inventory] = await Promise.all([
    read('../docs/inventory-audit.md'), read('../docs/coverage.md'), read('../INVENTORY.md'),
  ]);
  const expectedCapabilities = sortedUnique(capabilityIds(coverage), 'coverage');
  assert.deepEqual(sortedUnique(capabilityIds(audit), 'audit capabilities'), expectedCapabilities);
  const expectedFoundations = [...inventory.matchAll(/^- \[[ x]\] (F\d{2}):/gm)].map(match => match[1]);
  const actualFoundations = [...audit.matchAll(/^\|\s*(F\d{2})\s*\|/gm)].map(match => match[1]);
  assert.deepEqual(sortedUnique(actualFoundations, 'audit foundations'), sortedUnique(expectedFoundations, 'inventory foundations'));
  const mappedTracks = tracks(audit);
  assert.deepEqual(sortedUnique(mappedTracks.map(row => row.name), 'audit tracks'),
    sortedUnique(tracks(inventory).map(row => row.name), 'inventory tracks'));
  const referenced = new Set();
  for (const track of mappedTracks) {
    const ids = track.cells.replace(/\|\s*$/, '').trim().split(/\s+/);
    sortedUnique(ids, track.name);
    for (const id of ids) {
      assert(expectedCapabilities.includes(id), `${track.name}: unknown capability ${id}`);
      referenced.add(id);
    }
  }
  assert.deepEqual([...referenced].sort(), expectedCapabilities, 'every capability must map back to an inventory track');
});

test('audit evidence links resolve to declared local files, not inferred test outcomes', async () => {
  const audit = await readFile(auditUrl, 'utf8');
  const links = [...audit.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
  assert(links.length > 0);
  for (const link of links) {
    assert(!/^[a-z]+:/i.test(link), `audit source links must be local: ${link}`);
    assert((await stat(new URL(link, auditUrl))).isFile(), link);
  }
});
