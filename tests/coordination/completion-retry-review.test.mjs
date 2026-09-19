/** Integration review: real local locks and SQLite, synthetic adapters only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAttemptSupervisor, WorkspaceCoordinator, SqliteSessionStore } from '../../packages/storage/src/index.ts';
import { LockResources } from '../../packages/storage/src/lock-resources.ts';
import { fixture, workspace, amount, response, sql } from '../storage/job-fixtures.mjs';
const outcome = () => { const { local_stopped, ...value } = response(); return value; };
const hasCode = code => error => error?.code === code;
const receipt = f => JSON.parse(sql(f, 'SELECT usage_json FROM attempts WHERE job_id=?', f.job.ref.job_id)[0].usage_json);
const costs = f => sql(f, 'SELECT counters_json FROM sessions');
async function supervised(body) {
  return fixture(async f => {
    f.s.releaseLease(f.lease); WorkspaceCoordinator.initialize(f.directory, workspace);
    const supervisor = LocalAttemptSupervisor.open(f.directory, workspace, f.time);
    const lease = supervisor.store.acquireLease(f.b); f.useLease(lease);
    const job = f.job(); supervisor.store.admitJob(lease, job, job.ref);
    try { return await body({ ...f, supervisor, store: supervisor.store, lease, job, makeJob: f.job }); }
    finally { supervisor.close(); }
  });
}
function flush(f) {
  let value;
  assert.doesNotThrow(() => { value = f.supervisor.flushLocalCompletion(f.b, f.job.ref); });
  return value;
}

test('Completion retry review: real workspace contention preserves observation on initial write and flush', () => supervised(async f => {
  let resolve, calls = 0;
  const pending = new Promise(r => { resolve = r; });
  const done = f.supervisor.start(f.lease, f.job.ref, amount, () => { calls++; return pending; });
  const rejected = assert.rejects(done, hasCode('E_CONFLICT'));
  const resources = LockResources.open(f.directory, false);
  let acquired = false;
  try {
    resources.acquire(); acquired = true; resolve(outcome()); await rejected;
    assert.equal(Object.hasOwn(receipt(f), 'local_stop'), false);
    assert.throws(() => f.supervisor.flushLocalCompletion(f.b, f.job.ref), hasCode('E_CONFLICT'));
    assert.equal(Object.hasOwn(receipt(f), 'local_stop'), false);
  } finally {
    if (acquired) resources.release(); resources.close(); resolve(outcome()); await done.catch(() => {});
  }
  const before = f.store.readJob(f.b, f.job.ref), budget = costs(f);
  assert.equal(flush(f), true); assert.equal(flush(f), false);
  assert.ok(receipt(f).local_stop);
  assert.deepEqual(f.store.readJob(f.b, f.job.ref), before);
  assert.deepEqual(costs(f), budget); assert.equal(calls, 1);
}));

test('Completion retry review: post-commit error during explicit flush remains idempotently retryable', () => supervised(async f => {
  const original = SqliteSessionStore.prototype.recordObservedLocalCompletion;
  let calls = 0;
  SqliteSessionStore.prototype.recordObservedLocalCompletion = function() { throw Error('synthetic receipt failure before commit'); };
  try { await assert.rejects(f.supervisor.start(f.lease, f.job.ref, amount, async () => { calls++; return outcome(); }), hasCode('E_STORAGE')); }
  finally { SqliteSessionStore.prototype.recordObservedLocalCompletion = original; }
  assert.equal(Object.hasOwn(receipt(f), 'local_stop'), false);
  let commits = 0;
  SqliteSessionStore.prototype.recordObservedLocalCompletion = function(...args) {
    original.apply(this, args); commits++; throw Error('synthetic flush error after commit');
  };
  try { assert.throws(() => f.supervisor.flushLocalCompletion(f.b, f.job.ref), hasCode('E_STORAGE')); }
  finally { SqliteSessionStore.prototype.recordObservedLocalCompletion = original; }
  const before = receipt(f), job = f.store.readJob(f.b, f.job.ref), budget = costs(f);
  assert.equal(commits, 1); assert.ok(before.local_stop);
  assert.equal(flush(f), true); assert.equal(flush(f), false);
  assert.deepEqual(receipt(f), before); assert.deepEqual(f.store.readJob(f.b, f.job.ref), job);
  assert.deepEqual(costs(f), budget); assert.equal(calls, 1);
}));

test('Completion retry review: a new eligible job cannot overwrite an unacknowledged receipt', () => supervised(async f => {
  const original = SqliteSessionStore.prototype.recordObservedLocalCompletion;
  let oldCalls = 0, newCalls = 0;
  SqliteSessionStore.prototype.recordObservedLocalCompletion = function(...args) {
    original.apply(this, args); throw Error('synthetic first post-commit error');
  };
  try { await assert.rejects(f.supervisor.start(f.lease, f.job.ref, amount, async () => { oldCalls++; return outcome(); }), hasCode('E_STORAGE')); }
  finally { SqliteSessionStore.prototype.recordObservedLocalCompletion = original; }
  f.supervisor.cancel(f.lease, f.job.ref); f.store.recoverJobs(f.lease);
  const next = f.makeJob(); f.store.admitJob(f.lease, next, next.ref);
  const before = costs(f);
  // Observe both success and rejection before asserting, so mutant callbacks cannot leak tasks.
  let thrown, returned;
  try { returned = f.supervisor.start(f.lease, next.ref, amount, async () => { newCalls++; return outcome(); }); }
  catch (error) { thrown = error; }
  if (returned) await returned;
  assert.equal(thrown?.code, 'E_CONFLICT', 'pending receipt must block new admission even when SQL allows the next job');
  assert.equal(newCalls, 0); assert.equal(f.store.readJob(f.b, next.ref).attempts.length, 0);
  assert.deepEqual(costs(f), before); assert.equal(flush(f), true);
  const result = await f.supervisor.start(f.lease, next.ref, amount, async () => { newCalls++; return outcome(); });
  assert.equal(result.status, 'ready'); assert.equal(oldCalls, 1); assert.equal(newCalls, 1);
  assert.equal(f.store.readJob(f.b, f.job.ref).status, 'cancelled');
}));
