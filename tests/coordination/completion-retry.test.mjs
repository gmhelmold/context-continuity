/** Real storage/locks; synthetic adapters and injected receipt failures only.
 * Execution belongs to GitHub Actions. No network inference or replay fixture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LocalAttemptSupervisor, WorkspaceCoordinator, SqliteSessionStore } from '../../packages/storage/src/index.ts';
import { createSessionBinding } from '../../packages/core/src/identity.ts';
import { fixture, workspace, amount, response, sql, id } from '../storage/job-fixtures.mjs';

const receiptSQL = 'UPDATE attempts SET usage_json=? WHERE session_key=? AND attempt_id=? AND usage_json=?';
const isStorageError = error => error?.code === 'E_STORAGE';
const outcome = () => { const { local_stopped, ...data } = response(); return data; };
const envelope = f => JSON.parse(sql(f, 'SELECT usage_json FROM attempts WHERE attempt_no=1')[0].usage_json);
const counters = f => sql(f, 'SELECT counters_json FROM sessions');

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

/** Restrict injection to this receipt statement; all other queries use real SQLite. */
async function withReceiptWriteFailure(action) {
  const prepare = DatabaseSync.prototype.prepare;
  let hits = 0;
  DatabaseSync.prototype.prepare = function(query) {
    if (query === receiptSQL) { hits++; throw Error('synthetic receipt write failure'); }
    return prepare.call(this, query);
  };
  try { await action(); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(hits, 1, 'the intended receipt write must have been reached once');
}

async function leavePending(f) {
  let calls = 0;
  await withReceiptWriteFailure(() => assert.rejects(f.supervisor.start(
    f.lease, f.job.ref, amount, async () => { calls++; return outcome(); }), isStorageError));
  assert.equal(calls, 1);
  assert.equal(Object.hasOwn(envelope(f), 'local_stop'), false);
  return () => calls;
}

/** Keep a missing/failing success path visible as an assertion in mutation controls. */
function flush(f, binding = f.b, expected = f.job.ref) {
  let value;
  assert.doesNotThrow(() => { value = f.supervisor.flushLocalCompletion(binding, expected); });
  return value;
}

test('Completion retry: a transient write retains the fact without retaining or replaying the result', () => supervised(async f => {
  const calls = await leavePending(f), before = f.store.readJob(f.b, f.job.ref), quota = counters(f);
  assert.equal(flush(f), true, 'the original observation must remain available after the write error');
  assert.equal(envelope(f).local_stop.kind, 'native_promise_settled');
  assert.deepEqual(f.store.readJob(f.b, f.job.ref), before, 'receipt-only flush must not publish a result or stop a run');
  assert.deepEqual(counters(f), quota);
  const saved = envelope(f);
  assert.equal(flush(f), false, 'successful local acknowledgement removes only the pending entry');
  assert.deepEqual(envelope(f), saved);
  f.supervisor.cancel(f.lease, f.job.ref);
  const recovered = f.store.recoverJobs(f.lease)[0];
  assert.equal(recovered.status, 'cancelled');
  assert.equal(recovered.proposal, null);
  assert.equal(recovered.attempts[0].local_stopped, true);
  assert.equal(recovered.attempts[0].remote_state, 'unknown');
  assert.equal(calls(), 1);
  assert.equal(sql(f, 'SELECT count(*) AS n FROM attempts')[0].n, 1);
  assert.equal(sql(f, 'SELECT count(*) AS n FROM chapters')[0].n, 0);
  assert.deepEqual(counters(f), quota);
}));

test('Completion retry: another write failure cannot consume the pending observation', () => supervised(async f => {
  const calls = await leavePending(f), before = f.store.readJob(f.b, f.job.ref);
  await withReceiptWriteFailure(() => assert.throws(
    () => f.supervisor.flushLocalCompletion(f.b, f.job.ref), isStorageError));
  assert.equal(Object.hasOwn(envelope(f), 'local_stop'), false);
  assert.deepEqual(f.store.readJob(f.b, f.job.ref), before);
  assert.equal(flush(f), true, 'a failed explicit retry must leave the fact pending');
  assert.equal(flush(f), false);
  assert.equal(calls(), 1);
}));

test('Completion retry: original participant can flush after takeover without publishing its old result', () => supervised(async f => {
  const calls = await leavePending(f);
  f.advance(30001);
  const next = f.open(), lease = next.acquireLease(f.b);
  const before = next.recoverJobs(lease)[0], quota = counters(f);
  assert.equal(before.status, 'failed');
  assert.equal(before.attempts[0].local_state, 'quarantine');
  assert.equal(flush(f), true);
  assert.deepEqual(next.readJob(f.b, f.job.ref), before, 'the old participant records only a fact');
  const after = next.recoverJobs(lease)[0];
  assert.equal(after.status, before.status);
  assert.equal(after.error_code, before.error_code);
  assert.equal(after.proposal, null);
  assert.equal(after.attempts[0].local_state, 'stopped');
  assert.equal(after.attempts[0].state, 'unknown');
  assert.equal(after.attempts[0].remote_state, 'unknown');
  assert.equal(calls(), 1);
  assert.deepEqual(counters(f), quota);
  assert.deepEqual(next.recoverJobs(lease), []);
}));

test('Completion retry: mismatched generation or binding cannot acknowledge a pending receipt', () => supervised(async f => {
  await leavePending(f);
  for (const expected of [{ ...f.job.ref, job_id: id(999) }, { ...f.job.ref, context_digest: '0'.repeat(64) }]) {
    assert.throws(() => f.supervisor.flushLocalCompletion(f.b, expected), e => e.code === 'E_CONFLICT');
  }
  const otherEpoch = createSessionBinding(f.b.scope, f.b.incarnation, f.b.host_epoch + 1);
  assert.throws(() => f.supervisor.flushLocalCompletion(otherEpoch, f.job.ref), e => e.code === 'E_SCOPE');
  const foreign = createSessionBinding({ ...f.b.scope, workspace_id: id(777) }, f.b.incarnation, f.b.host_epoch);
  assert.throws(() => f.supervisor.flushLocalCompletion(foreign, f.job.ref), e => e.code === 'E_SCOPE');
  assert.equal(Object.hasOwn(envelope(f), 'local_stop'), false);
  assert.equal(flush(f), true);
}));

test('Completion retry: an invalid adapter never supplies a pending completion fact', () => supervised(async f => {
  const result = await f.supervisor.start(f.lease, f.job.ref, amount, () => outcome());
  assert.equal(result.attempts[0].local_stopped, false);
  assert.equal(flush(f), false);
  assert.equal(Object.hasOwn(envelope(f), 'local_stop'), false);
  assert.equal(f.store.recoverJobs(f.lease)[0].attempts[0].local_state, 'quarantine');
}));

test('Completion retry: explicit close abandons memory without inventing a durable receipt', () => supervised(async f => {
  await leavePending(f);
  const before = envelope(f), quota = counters(f);
  f.supervisor.close(); f.supervisor.close();
  assert.deepEqual(envelope(f), before, 'close does not retry, forge a receipt, or modify the attempt');
  assert.throws(() => f.supervisor.flushLocalCompletion(f.b, f.job.ref), e => e.code === 'E_OWNER');
  f.advance(30001);
  const next = f.open(), lease = next.acquireLease(f.b);
  const recovered = next.recoverJobs(lease)[0];
  assert.equal(recovered.attempts[0].local_state, 'quarantine');
  assert.equal(recovered.attempts[0].local_stopped, false);
  assert.equal(recovered.attempts[0].remote_state, 'unknown');
  assert.deepEqual(counters(f), quota);
}));

test('Completion retry: a failed result write does not queue a receipt already acknowledged', () => supervised(async f => {
  const original = SqliteSessionStore.prototype.recordJobAttemptResult;
  SqliteSessionStore.prototype.recordJobAttemptResult = function() { throw Error('synthetic result write failure'); };
  try { await assert.rejects(f.supervisor.start(f.lease, f.job.ref, amount, async () => outcome()), isStorageError); }
  finally { SqliteSessionStore.prototype.recordJobAttemptResult = original; }
  assert.equal(envelope(f).local_stop.kind, 'native_promise_settled');
  assert.equal(flush(f), false);
  assert.equal(f.store.readJob(f.b, f.job.ref).proposal, null);
  f.supervisor.cancel(f.lease, f.job.ref);
  assert.equal(f.store.recoverJobs(f.lease)[0].attempts[0].local_stopped, true);
}));

test('Completion retry: an error after receipt commit permits an idempotent explicit acknowledgement', () => supervised(async f => {
  const original = SqliteSessionStore.prototype.recordObservedLocalCompletion;
  let commits = 0, calls = 0;
  SqliteSessionStore.prototype.recordObservedLocalCompletion = function(...args) {
    original.apply(this, args); commits++; throw Error('synthetic error after receipt committed');
  };
  try { await assert.rejects(f.supervisor.start(f.lease, f.job.ref, amount, async () => { calls++; return outcome(); }), isStorageError); }
  finally { SqliteSessionStore.prototype.recordObservedLocalCompletion = original; }
  assert.equal(commits, 1);
  const before = envelope(f), job = f.store.readJob(f.b, f.job.ref), quota = counters(f);
  assert.equal(before.local_stop.kind, 'native_promise_settled');
  assert.equal(flush(f), true);
  assert.deepEqual(envelope(f), before);
  assert.deepEqual(f.store.readJob(f.b, f.job.ref), job);
  assert.deepEqual(counters(f), quota);
  assert.equal(calls, 1);
  assert.equal(flush(f), false);
}));

test('Completion retry: a pending native operation cannot be flushed before settlement', () => supervised(async f => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const done = f.supervisor.start(f.lease, f.job.ref, amount, () => pending);
  try {
    assert.equal(flush(f), false);
    assert.equal(Object.hasOwn(envelope(f), 'local_stop'), false);
    assert.throws(() => f.supervisor.close(), e => e.code === 'E_CONFLICT');
  } finally { resolve(outcome()); await done; }
  assert.equal(flush(f), false);
  assert.equal(f.store.readJob(f.b, f.job.ref).status, 'ready');
}));

test('Completion retry: receipt rollback preserves the fact for another explicit write', () => supervised(async f => {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  let armed = false, failures = 0;
  DatabaseSync.prototype.prepare = function(query) {
    const statement = prepare.call(this, query);
    if (query === receiptSQL) {
      const run = statement.run;
      statement.run = function(...args) { const value = run.apply(this, args); armed = true; return value; };
    }
    return statement;
  };
  DatabaseSync.prototype.exec = function(query) {
    if (armed && query === 'COMMIT') { armed = false; failures++; throw Error('synthetic receipt COMMIT failure'); }
    return exec.call(this, query);
  };
  try { await assert.rejects(f.supervisor.start(f.lease, f.job.ref, amount, async () => outcome()), isStorageError); }
  finally { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec; }
  assert.equal(failures, 1);
  assert.equal(Object.hasOwn(envelope(f), 'local_stop'), false);
  assert.equal(f.store.readJob(f.b, f.job.ref).attempts[0].local_state, 'running');
  assert.equal(flush(f), true);
  assert.equal(envelope(f).local_stop.kind, 'native_promise_settled');
}));

test('Completion retry: rejected operation observation survives a receipt error without becoming remote success', () => supervised(async f => {
  let calls = 0;
  await withReceiptWriteFailure(() => assert.rejects(f.supervisor.start(f.lease, f.job.ref, amount, async () => {
    calls++; throw Error('private rejected operation fixture');
  }), isStorageError));
  const quota = counters(f);
  assert.equal(flush(f), true);
  assert.equal(envelope(f).local_stop.kind, 'native_promise_settled');
  f.supervisor.cancel(f.lease, f.job.ref);
  const job = f.store.recoverJobs(f.lease)[0];
  assert.equal(job.status, 'cancelled');
  assert.equal(job.proposal, null);
  assert.equal(job.attempts[0].remote_state, 'unknown');
  assert.equal(job.attempts[0].local_stopped, true);
  assert.equal(calls, 1);
  assert.deepEqual(counters(f), quota);
  assert.equal(JSON.stringify(sql(f, 'SELECT * FROM attempts')).includes('private rejected operation fixture'), false);
}));
