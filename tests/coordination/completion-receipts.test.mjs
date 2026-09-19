/** Real SQLite and lock resources; trusted synthetic adapters, no provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LocalAttemptSupervisor, WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { observeLocalCompletion } from '../../packages/storage/src/local-completion.ts';
import { hashPayload } from '../../packages/core/src/identity.ts';
import { fixture, workspace, amount, response, sql, id } from '../storage/job-fixtures.mjs';
const outcome = () => { const { local_stopped, ...value } = response(); return value; };
const rejects = (fn, code) => assert.throws(fn, e => e.code === code);
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

async function owned(body, { dispatched = true } = {}) {
  return fixture(async f => {
    WorkspaceCoordinator.initialize(f.directory, workspace);
    const coordinator = WorkspaceCoordinator.open(f.directory, workspace), job = f.job();
    f.s.admitJob(f.lease, job, job.ref);
    const attempt = coordinator.withWorkspaceLock(h => f.s.reserveJobAttempt(f.lease, job.ref, amount, h));
    if (dispatched) coordinator.withWorkspaceLock(h => f.s.markJobAttemptDispatched(f.lease, job.ref, attempt, h));
    const ownership = f.s.readAttemptOwnership(f.b, job.ref, attempt);
    const { observation } = await observeLocalCompletion(ownership, Promise.resolve(undefined));
    const g = { ...f, coordinator, job, attempt, ownership, observation };
    g.save = (proof = observation) => coordinator.withWorkspaceLock(h => f.s.recordObservedLocalCompletion(f.lease, job.ref, attempt, proof, h));
    g.envelope = () => JSON.parse(sql(f, 'SELECT usage_json FROM attempts WHERE attempt_id=?', attempt.attempt_id)[0].usage_json);
    try { return await body(g); } finally { coordinator.close(); }
  });
}

test('Completion: receipt is idempotent and does not itself change an active run', () => owned(async f => {
  const before = f.s.readJob(f.b, f.job.ref), counters = sql(f, 'SELECT counters_json FROM sessions');
  f.save(); const first = f.envelope(); f.save();
  assert.deepEqual(f.envelope(), first);
  assert.equal(first.local_stop.kind, 'native_promise_settled');
  assert.deepEqual(f.s.readJob(f.b, f.job.ref), before);
  assert.deepEqual(sql(f, 'SELECT counters_json FROM sessions'), counters);
  const recovered = f.s.recoverJobs(f.lease)[0];
  assert.equal(recovered.status, 'running'); assert.equal(recovered.attempts[0].local_state, 'running');
}));

test('Completion: unissued and copied observations cannot create a receipt', () => owned(async f => {
  const before = f.envelope();
  for (const proof of [true, null, {}, { ...f.observation }, JSON.parse(JSON.stringify(f.observation))]) {
    rejects(() => f.save(proof), 'E_OWNER');
    assert.deepEqual(f.envelope(), before);
  }
  f.save(); assert.ok(f.envelope().local_stop);
}));

test('Completion: observation of another attempt is not transferable', () => owned(async f => {
  const foreign = { ...f.ownership, attempt: { ...f.attempt, run_id: id(800) } };
  const { observation } = await observeLocalCompletion(foreign, Promise.resolve(undefined));
  rejects(() => f.save(observation), 'E_OWNER');
  assert.equal(Object.hasOwn(f.envelope(), 'local_stop'), false);
}));

test('Completion: original store is required even when another connection knows its lease', () => owned(async f => {
  const other = f.open();
  rejects(() => f.coordinator.withWorkspaceLock(h => other.recordObservedLocalCompletion(f.lease, f.job.ref, f.attempt, f.observation, h)), 'E_OWNER');
  assert.equal(Object.hasOwn(f.envelope(), 'local_stop'), false);
  f.save(); assert.ok(f.envelope().local_stop);
}));

test('Completion: expired or foreign holds cannot preserve an observation', () => owned(async f => {
  let stale; f.coordinator.withWorkspaceLock(h => { stale = h; });
  rejects(() => f.s.recordObservedLocalCompletion(f.lease, f.job.ref, f.attempt, f.observation, stale), 'E_OWNER');
  const other = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    rejects(() => other.withWorkspaceLock(h => f.s.recordObservedLocalCompletion(f.lease, f.job.ref, f.attempt, f.observation, h)), 'E_OWNER');
  } finally { other.close(); }
  assert.equal(Object.hasOwn(f.envelope(), 'local_stop'), false);
}));

test('Completion: original generation is required and reserved work has no settlement receipt', () => owned(async f => {
  rejects(() => f.coordinator.withWorkspaceLock(h => f.s.recordObservedLocalCompletion({ ...f.lease, owner_fence: f.lease.owner_fence + 1 }, f.job.ref, f.attempt, f.observation, h)), 'E_OWNER');
  rejects(() => f.save(), 'E_OWNER');
  assert.equal(Object.hasOwn(f.envelope(), 'local_stop'), false);
}, { dispatched: false }));

test('Completion: same participant can preserve its observation after the session lease expires', () => owned(async f => {
  f.advance(30001); const other = f.open(), lease = other.acquireLease(f.b);
  f.save();
  assert.equal(other.readJob(f.b, f.job.ref).status, 'running');
  assert.equal(other.readJob(f.b, f.job.ref).attempts[0].local_stopped, false);
  const job = other.recoverJobs(lease)[0];
  assert.equal(job.status, 'failed'); assert.equal(job.error_code, 'E_OWNER');
  assert.equal(job.attempts[0].local_stopped, true); assert.equal(job.attempts[0].remote_state, 'unknown');
}));

test('Completion: missing receipt cannot be replaced by closing or retiring the owner', () => supervised(async f => {
  const failed = await f.supervisor.start(f.lease, f.job.ref, amount, () => outcome());
  assert.equal(failed.status, 'failed'); assert.equal(failed.attempts[0].local_stopped, false);
  const stored = JSON.parse(sql(f, 'SELECT usage_json FROM attempts')[0].usage_json);
  assert.equal(Object.hasOwn(stored, 'local_stop'), false);
  f.supervisor.close(); f.advance(30001);
  const other = f.open(), lease = other.acquireLease(f.b);
  for (let i = 0; i < 2; i++) {
    const recovered = other.recoverJobs(lease)[0];
    assert.equal(recovered.attempts[0].local_state, 'quarantine');
    assert.equal(recovered.attempts[0].local_stopped, false);
  }
}));

test('Completion: rejected native Promise is evidence of cleanup but never remote success', () => supervised(async f => {
  const d = deferred(), done = f.supervisor.start(f.lease, f.job.ref, amount, () => d.promise);
  const failed = assert.rejects(done, e => e.code === 'E_OWNER');
  f.advance(30001); const other = f.open(), lease = other.acquireLease(f.b);
  try { other.recoverJobs(lease); } finally { d.reject(Error('synthetic operation failure')); }
  await failed;
  const job = other.recoverJobs(lease)[0];
  assert.equal(job.attempts[0].local_stopped, true);
  assert.equal(job.attempts[0].remote_state, 'unknown'); assert.equal(job.proposal, null);
  assert.equal(JSON.stringify(sql(f, 'SELECT * FROM attempts')).includes('synthetic operation failure'), false);
}));

test('Completion: corrupted receipt rolls recovery back without releasing its slot', () => owned(async f => {
  f.s.cancelJob(f.lease, f.job.ref); f.save();
  const saved = f.envelope(), before = sql(f, 'SELECT * FROM aux_runs');
  const clock = sql(f, "SELECT value FROM meta WHERE key='clock_high_water_ms'");
  for (const receipt of [null, {}, { ...saved.local_stop, schema_version: 2 }, { ...saved.local_stop, digest: '0'.repeat(64) }]) {
    sql(f, 'UPDATE attempts SET usage_json=? WHERE attempt_id=?', JSON.stringify({ ...saved, local_stop: receipt }), f.attempt.attempt_id);
    rejects(() => f.s.recoverJobs(f.lease), 'E_STORAGE');
    assert.deepEqual(sql(f, 'SELECT * FROM aux_runs'), before);
    assert.deepEqual(sql(f, "SELECT value FROM meta WHERE key='clock_high_water_ms'"), clock);
  }
  sql(f, 'UPDATE attempts SET usage_json=? WHERE attempt_id=?', JSON.stringify(saved), f.attempt.attempt_id);
  assert.equal(f.s.recoverJobs(f.lease)[0].attempts[0].local_stopped, true);
}));

test('Completion: recovery verifies receipt ownership fence against the original job', () => owned(async f => {
  f.s.cancelJob(f.lease, f.job.ref); f.save();
  const saved = f.envelope(), value = { ...saved.value, owner_fence: saved.value.owner_fence + 1 };
  const altered = { value, digest: hashPayload(value), local_stop: { ...saved.local_stop,
    digest: hashPayload({ domain: 'context-continuity.local-stop.v1', ownership: value }) } };
  sql(f, 'UPDATE attempts SET usage_json=? WHERE attempt_id=?', JSON.stringify(altered), f.attempt.attempt_id);
  rejects(() => f.s.recoverJobs(f.lease), 'E_STORAGE');
  assert.equal(sql(f, 'SELECT local_stopped FROM aux_runs')[0].local_stopped, 0);
  sql(f, 'UPDATE attempts SET usage_json=? WHERE attempt_id=?', JSON.stringify(saved), f.attempt.attempt_id);
}));

test('Completion: receipt cannot be consumed with an expired recovery lease', () => owned(async f => {
  f.s.cancelJob(f.lease, f.job.ref); f.save(); f.advance(30001);
  rejects(() => f.s.recoverJobs(f.lease), 'E_OWNER');
  assert.equal(sql(f, 'SELECT local_stopped FROM aux_runs')[0].local_stopped, 0);
}));

test('Completion: failed receipt COMMIT leaves no durable observation and retry is idempotent', () => owned(async f => {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec; let armed = false, failed = 0;
  DatabaseSync.prototype.prepare = function(q) {
    const st = prepare.call(this, q);
    if (q === 'UPDATE attempts SET usage_json=? WHERE session_key=? AND attempt_id=? AND usage_json=?') {
      const run = st.run; st.run = function(...args) { const result = run.apply(this, args); armed = true; return result; };
    }
    return st;
  };
  DatabaseSync.prototype.exec = function(q) {
    if (armed && q === 'COMMIT') { failed++; armed = false; throw Error('synthetic receipt commit failure'); }
    return exec.call(this, q);
  };
  try { rejects(() => f.save(), 'E_STORAGE'); }
  finally { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec; }
  assert.equal(failed, 1); assert.equal(Object.hasOwn(f.envelope(), 'local_stop'), false);
  assert.equal(f.s.readJob(f.b, f.job.ref).attempts[0].local_state, 'running');
  f.save(); const saved = f.envelope(); f.save(); assert.deepEqual(f.envelope(), saved);
}));

test('Completion: failed recovery COMMIT preserves quarantine and costs', () => owned(async f => {
  f.s.cancelJob(f.lease, f.job.ref); f.save();
  const before = sql(f, 'SELECT * FROM aux_runs'), counters = sql(f, 'SELECT counters_json FROM sessions');
  const exec = DatabaseSync.prototype.exec; let failed = 0;
  DatabaseSync.prototype.exec = function(q) { if (q === 'COMMIT') { failed++; throw Error('synthetic recovery commit failure'); } return exec.call(this, q); };
  try { rejects(() => f.s.recoverJobs(f.lease), 'E_STORAGE'); }
  finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(failed, 1); assert.deepEqual(sql(f, 'SELECT * FROM aux_runs'), before);
  assert.deepEqual(sql(f, 'SELECT counters_json FROM sessions'), counters);
  assert.equal(f.s.recoverJobs(f.lease)[0].attempts[0].local_stopped, true);
}));

test('Completion: a receipt for one retry cannot release a different attempt', () => supervised(async f => {
  await f.supervisor.start(f.lease, f.job.ref, amount, async () => ({ kind: 'http_error', status: 503, retry_after_ms: 1 }));
  const first = JSON.parse(sql(f, 'SELECT usage_json FROM attempts WHERE attempt_no=1')[0].usage_json).local_stop;
  f.advance(1); const d = deferred(), done = f.supervisor.start(f.lease, f.job.ref, amount, () => d.promise);
  const failed = assert.rejects(done, e => e.code === 'E_STORAGE');
  const second = JSON.parse(sql(f, 'SELECT usage_json FROM attempts WHERE attempt_no=2')[0].usage_json);
  f.supervisor.cancel(f.lease, f.job.ref);
  sql(f, 'UPDATE attempts SET usage_json=? WHERE attempt_no=2', JSON.stringify({ ...second, local_stop: first }));
  try { rejects(() => f.store.recoverJobs(f.lease), 'E_STORAGE'); }
  finally { d.resolve(outcome()); }
  await failed;
  assert.equal(sql(f, 'SELECT local_stopped FROM aux_runs WHERE attempt_no=2')[0].local_stopped, 0);
  assert.equal(sql(f, 'SELECT count(*) AS n FROM attempts')[0].n, 2);
}));
