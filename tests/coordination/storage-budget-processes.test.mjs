/** Fresh-process reads and two independent writers use the real ledger in Actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { WORKSPACE_CONTENT_QUOTA_BYTES as QUOTA } from '../../packages/storage/src/index.ts';
import { budgetFixture, workspace, binding, config, source, retain, reserve, blob, sql } from './storage-budget-fixtures.mjs';
const moduleURL = new URL('../../packages/storage/src/index.ts', import.meta.url).href;
const environment = () => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env; };

test('Budget process: a fresh participant observes charges without replay or cleanup', () => budgetFixture(f => {
  retain(f, [source(10, 'original')]); blob(f, 1, 23); reserve(f, 101, 31);
  const expected = f.c.readStorageBudget();
  const before = ['sources','blobs','storage_reservations','sessions','jobs','attempts']
    .map(table => sql(f, `SELECT * FROM ${table} ORDER BY rowid`));
  const code = `import {WorkspaceCoordinator} from ${JSON.stringify(moduleURL)};
    const c=WorkspaceCoordinator.open(${JSON.stringify(f.directory)},${JSON.stringify(workspace)});
    try { console.log(JSON.stringify(c.readStorageBudget())); } finally { c.close(); }`;
  const run = spawnSync(process.execPath, ['--experimental-strip-types','--input-type=module','-e',code],
    { env: environment(), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim()), expected);
  assert.deepEqual(['sources','blobs','storage_reservations','sessions','jobs','attempts']
    .map(table => sql(f, `SELECT * FROM ${table} ORDER BY rowid`)), before);
}));

async function deadline(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(label + ' was not reached')), 15000);
  })]); } finally { clearTimeout(timer); }
}
function writer(f, b, n) {
  const supplied = source(n), input = { directory: f.directory, workspace, binding: b,
    source: { ...supplied, bytes: [...supplied.bytes] } };
  const code = `import {SqliteSessionStore} from ${JSON.stringify(moduleURL)};
    const p=${JSON.stringify(input)}, s=SqliteSessionStore.open(p.directory,p.workspace,()=>100001);
    const lease=s.acquireLease(p.binding), expected=s.readRootCatalog(p.binding).catalog_digest;
    process.once('message', () => {
      let result;
      try { s.retainRoots(lease,{expected_catalog_digest:expected,sources:[{...p.source,bytes:Buffer.from(p.source.bytes)}],observations:[]}); result='committed'; }
      catch(e) { result=e.code; }
      finally { s.close(); }
      process.send({phase:'result',result}, () => process.disconnect());
    });
    process.send({phase:'ready'});`;
  const child = spawn(process.execPath, ['--experimental-strip-types','--input-type=module','-e',code],
    { env: environment(), stdio: ['ignore','ignore','pipe','ipc'] });
  let errors = '', spawnError;
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8192); });
  child.on('error', error => { spawnError = error; });
  const exit = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null }));
  });
  const ready = Promise.race([once(child, 'message').then(([message]) => message),
    exit.then(() => { throw Error('writer exited before barrier: ' + errors); })]);
  // Observed immediately; the parent still awaits this same promise before release.
  ready.catch(() => {});
  return { child, ready, exit, details: () => ({ errors, spawnError }) };
}

test('Budget process: two sessions cannot both spend the final shared byte', { timeout: 45000 }, () => budgetFixture(async f => {
  const b = binding('budget-B'); f.s.createSession(b, config); f.s.releaseLease(f.lease);
  reserve(f, 101, QUOTA - 1);
  const participants = [writer(f, f.b, 10), writer(f, b, 11)];
  try {
    const ready = await deadline(Promise.all(participants.map(p => p.ready)), 'writer readiness');
    assert.ok(ready.every(message => message.phase === 'ready'));
    const outputs = participants.map(p => Promise.race([
      once(p.child, 'message').then(([message]) => message),
      p.exit.then(() => { throw Error('writer exited without result: ' + p.details().errors); }),
    ]));
    for (const p of participants) p.child.send('go');
    const results = await deadline(Promise.all(outputs), 'writer results');
    const exits = await deadline(Promise.all(participants.map(p => p.exit)), 'writer exits');
    for (let i = 0; i < participants.length; i++) {
      assert.equal(participants[i].details().spawnError, undefined);
      assert.deepEqual(exits[i], { code: 0, signal: null }, participants[i].details().errors);
    }
    assert.deepEqual(results.map(r => r.result).sort(), ['E_BUDGET','committed'], 'BUDGET_TWO_WRITERS');
    assert.equal(sql(f, 'SELECT COUNT(*) AS n FROM sources')[0].n, 1);
    assert.equal(f.c.readStorageBudget().used_bytes, QUOTA);
  } finally {
    for (const p of participants) if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
    await Promise.all(participants.map(p => p.exit));
  }
}));
