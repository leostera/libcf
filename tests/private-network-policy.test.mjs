import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorker } from '../examples/test/local-worker.mjs';

test('mTLS and VPC fixture declarations fail before bundling, including empty and remote:false declarations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libcf-private-network-policy-'));
  try {
    const path = join(directory, 'worker.jsonc');
    const rejected = /mTLS and VPC require an owned certificate\/network and approval plan/;
    for (const [field, binding] of [
      ['mtls_certificates', { binding: 'CERT', certificate_id: 'unapproved-certificate' }],
      ['vpc_services', { binding: 'PRIVATE', service_id: 'unapproved-service' }],
      ['vpc_networks', { binding: 'NETWORK', tunnel_id: 'unapproved-tunnel' }],
      ['vpc_networks', { binding: 'NETWORK', network_id: 'cf1:network' }],
    ]) {
      for (const declaration of [null, [], false, [binding], [{ ...binding, remote: false }], [{ ...binding, remote: true }]]) {
        await writeFile(path, JSON.stringify({ name: 'private-policy', main: 'missing.mjs', [field]: declaration }));
        // If policy runs too late this would instead fail at the missing entrypoint.
        await assert.rejects(startLocalWorker(path), rejected);
      }
      await assert.rejects(startLocalWorker('examples/hello/plain.wrangler.jsonc', { additionalConfigs: [path] }), rejected);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
