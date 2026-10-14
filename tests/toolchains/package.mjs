import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { inspectSdk } from '../../scripts/sdk-archive.mjs';

const [unpacker] = process.argv.slice(2);
const root = await mkdtemp(resolve(tmpdir(), 'libcf-sdk-inventory-'));
try {
  const { sdk, files } = await inspectSdk(unpacker, 'cf-0.1.0.tar.gz', root);
  await unlink(`${sdk}/lib/subtle-crypto.mjs`);
  await assert.rejects(build({
    entryPoints: [`${sdk}/lib/runtime.mjs`], bundle: true, write: false,
    format: 'esm', platform: 'browser', external: ['cloudflare:*'], logLevel: 'silent',
  }), /subtle-crypto/);
  console.log(`Verified ${files.length} SDK files and missing-adapter rejection`);
} finally { await rm(root, { recursive: true, force: true }); }
