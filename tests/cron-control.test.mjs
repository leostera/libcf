import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
async function fixture(environment, check) {
  const root = await mkdtemp(join(tmpdir(), "libcf-cron-test-"));
  try {
    const log = join(root, "calls.jsonl");
    await writeFile(
      join(root, "cf"),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(process.env.MOCK_LOG) ? fs.readFileSync(process.env.MOCK_LOG, 'utf8') : '';
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'd1' && args[1] === 'get' && !previous.includes('"delete"')) {
  console.log(JSON.stringify({name: process.env.MOCK_DB_NAME || 'libcf-cron-db-0123456789'}));
} else if (args[1] === 'get') {
  console.error('[' + (args[0] === 'd1' ? '7404' : '10007') + '] 404 Not Found');
  process.exitCode = 1;
} else if (args[1] === 'query') {
  if (process.env.MOCK_QUERY_FAIL) { console.error('synthetic query failure'); process.exitCode = 2; }
  else if (process.env.MOCK_NO_EVENTS) console.log(JSON.stringify([{success:true,results:[]}]));
  else console.log(JSON.stringify([{success:true, results:['js','cpp'].map(implementation => ({implementation, cron:'* * * * *', time:Math.floor(Date.now()/60000)*60000}))}]));
} else console.log('{}');
`,
      { mode: 0o755 },
    );
    const manifest = join(root, "deployment.json");
    await writeFile(
      manifest,
      JSON.stringify({
        databaseId: "00000000-0000-0000-0000-000000000002",
        workers: ["js", "cpp"].map((kind) => ({ kind, name: `libcf-cron-${kind}-0123456789` })),
      }),
    );
    const run = () =>
      execute(
        process.execPath,
        [resolve("scripts/test-live-cron-control.mjs"), manifest, "--cleanup"],
        {
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            MOCK_LOG: log,
            ...environment,
          },
          timeout: 10000,
        },
      );
    await check(run, async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Cron control observes both implementations and verifies cleanup", async () => {
  await fixture({}, async (run, calls) => {
    const { stdout } = await run();
    assert.match(stdout, /real Cron delivery in both JS and C\+\+/);
    assert.match(stdout, /"cleanup":"verified"/);
    assert.equal((await calls()).filter((args) => args[1] === "delete").length, 3);
  });
});

test("Cron diagnostic cleans up even when the query fails", async () => {
  await fixture({ MOCK_QUERY_FAIL: "1" }, async (run, calls) => {
    await assert.rejects(
      run(),
      (error) =>
        /synthetic query failure/.test(error.stderr) && /"cleanup":"verified"/.test(error.stdout),
    );
    assert.equal((await calls()).filter((args) => args[1] === "delete").length, 3);
  });
});

test('Cron observation timeout still runs cleanup with fresh command budgets', async () => {
  await fixture({ MOCK_NO_EVENTS: '1', LIBCF_LIVE_CRON_TIMEOUT_MS: '200' }, async (run, calls) => {
    await assert.rejects(run(), error =>
      /aborted|Cron control/.test(error.stderr) && /"cleanup":"verified"/.test(error.stdout));
    assert.equal((await calls()).filter(args => args[1] === 'delete').length, 3);
  });
});

test("Cron diagnostic refuses ownership of a non-test database", async () => {
  await fixture({ MOCK_DB_NAME: "production" }, async (run, calls) => {
    await assert.rejects(run(), /non-diagnostic database/);
    assert.equal((await calls()).length, 1);
  });
});
