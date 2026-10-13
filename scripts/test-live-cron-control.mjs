import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

// Explicit opt-in. This diagnostic owns/deletes the isolated resources in its
// generated manifest, even when no scheduled event arrives before the deadline.
if (process.argv.length !== 4 || process.argv[3] !== '--cleanup')
  throw new Error('Usage: node scripts/test-live-cron-control.mjs <test-deployment.json> --cleanup');
const deployment = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(deployment.databaseId));
assert.equal(deployment.workers?.length, 2);
const suffixes = new Set();
for (const kind of ['js', 'cpp']) {
  const worker = deployment.workers.find(worker => worker.kind === kind);
  const match = new RegExp(`^libcf-cron-${kind}-([a-f0-9]{10})$`).exec(worker?.name ?? '');
  assert(match, 'Only isolated Cron-control Workers may be deleted');
  suffixes.add(match[1]);
}
assert.equal(suffixes.size, 1, 'Workers must belong to the same diagnostic cohort');
const execute = promisify(execFile);
const cf = args => execute('cf', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
const database = JSON.parse((await cf(['d1', 'get', deployment.databaseId])).stdout);
assert(/^libcf-cron-db-[a-f0-9]{10}$/.test(database.name ?? ''), 'Refusing to own a non-diagnostic database');
const sql = "SELECT 'js' AS implementation,time,cron FROM cron_control UNION ALL SELECT 'cpp',CAST(time AS INTEGER),cron FROM schedules";
const started = Date.now();
try {
  let observed = false;
  for (let attempt = 0; Date.now() - started < 20 * 60 * 1000; attempt++) {
    const { stdout } = await cf(['d1', 'query', deployment.databaseId, '--sql', sql]);
    const results = JSON.parse(stdout);
    assert(results.every(result => result.success));
    const rows = results.flatMap(result => result.results);
    const kinds = new Set();
    for (const row of rows) {
      assert.equal(row.cron, '* * * * *');
      assert(Number.isSafeInteger(row.time) && row.time % 60000 === 0);
      assert(row.time >= started - 5 * 60 * 1000 && row.time <= Date.now() + 60000);
      kinds.add(row.implementation);
    }
    if (kinds.has('js') && kinds.has('cpp')) {
      console.log(JSON.stringify({ passed: 'real Cron delivery in both JS and C++', rows }));
      observed = true;
      break;
    }
    if (attempt % 5 === 0) console.log(JSON.stringify({ elapsedMs: Date.now() - started, observed: [...kinds] }));
    await sleep(20000);
  }
  assert(observed, 'Cron control did not observe both implementations within 20 minutes');
} finally {
  const failures = [];
  for (const worker of deployment.workers) {
    try { await cf(['workers', 'delete', worker.name, '--force']); }
    catch { failures.push(`Worker deletion failed: ${worker.name}`); }
  }
  try { await cf(['d1', 'delete', deployment.databaseId, '--force']); }
  catch { failures.push(`D1 deletion failed: ${deployment.databaseId}`); }
  for (const [args, code] of [
    ...deployment.workers.map(worker => [['workers', 'get', worker.name], '10007']),
    [['d1', 'get', deployment.databaseId], '7404'],
  ]) {
    try {
      await cf(args);
      failures.push(`Resource still exists: ${args.join(' ')}`);
    } catch (error) {
      if (!error.stderr?.includes(`[${code}]`) || !error.stderr.includes('404 Not Found'))
        failures.push(`Deletion could not be verified: ${args.join(' ')}`);
    }
  }
  console.log(JSON.stringify({ cleanup: failures.length ? 'incomplete' : 'verified', failures }));
  if (failures.length) throw new Error('Cron diagnostic cleanup requires attention');
}
