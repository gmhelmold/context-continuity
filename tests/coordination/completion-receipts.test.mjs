/** Real SQLite and lock resources; trusted synthetic adapters, no provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAttemptSupervisor, WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { fixture, workspace, amount, response, sql } from '../storage/job-fixtures.mjs';
const outcome = () => { const { local_stopped, ...value } = response(); return value; };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function supervised(body) {
  return fixture(async f => {
    f.s.releaseLease(f.lease);
    WorkspaceCoordinator.initialize(f.directory, workspace);
    const supervisor = LocalAttemptSupervisor.open(f.directory, workspace, f.time);
    const lease = supervisor.store.acquireLease(f.b); f.useLease(lease);
    const job = f.job(); supervisor.store.admitJob(lease, job, job.ref);
    try { return await body({ ...f, supervisor, store: supervisor.store, lease, job }); }
    finally { supervisor.close(); }
  });
}

test('Completion: settled old supervisor lets current owner reconcile without replay', () => supervised(async f => {
  const d = deferred(); let calls = 0;
  const done = f.supervisor.start(f.lease, f.job.ref, amount, () => { calls++; return d.promise; });
  const rejected = assert.rejects(done, e => e.code === 'E_OWNER');
  f.advance(30001);
  const next = f.open(), lease = next.acquireLease(f.b);
  try {
    const recovered = next.recoverJobs(lease)[0];
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.attempts[0].local_state, 'quarantine');
    assert.equal(recovered.attempts[0].local_stopped, false);
  } finally { d.resolve(outcome()); }
  await rejected;
  // The old callback records only evidence; it still cannot publish or release the slot.
  const before = next.readJob(f.b, f.job.ref);
  assert.equal(before.attempts[0].local_state, 'quarantine');
  const counters = sql(f, 'SELECT counters_json FROM sessions')[0].counters_json;
  const after = next.recoverJobs(lease)[0];
  assert.equal(after.attempts[0].local_state, 'stopped');
  assert.equal(after.attempts[0].local_stopped, true);
  assert.equal(after.status, before.status);
  assert.equal(after.error_code, before.error_code);
  assert.equal(after.proposal, null);
  assert.equal(after.attempts[0].state, 'unknown');
  assert.equal(after.attempts[0].remote_state, 'unknown');
  assert.equal(after.attempts[0].input_reserved, amount.input_tokens);
  assert.equal(calls, 1);
  assert.equal(sql(f, 'SELECT counters_json FROM sessions')[0].counters_json, counters);
  assert.equal(sql(f, 'SELECT count(*) AS n FROM attempts')[0].n, 1);
  assert.equal(sql(f, 'SELECT count(*) AS n FROM chapters')[0].n, 0);
  assert.deepEqual(next.recoverJobs(lease), []);
}));
