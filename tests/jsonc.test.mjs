import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFixtureConfig } from '../examples/test/jsonc.mjs';

test('fixture JSONC supports comments and formatter-produced trailing commas', () => {
  const config = parseFixtureConfig('/* fixture */ { "name": "test", "vars": { "URL": "https://example.test//path", }, }');
  assert.equal(config.name, 'test');
  assert.equal(config.vars.URL, 'https://example.test//path');
});

test('malformed or non-object JSONC is rejected rather than partially recovered', () => {
  for (const input of ['{"name": }', '{"x":1} garbage', '', '[]', 'null', '123'])
    assert.throws(() => parseFixtureConfig(input));
});
