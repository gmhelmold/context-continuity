/** SPEC-25: one identified pre-file reservation, never general owner recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { LockResources } from '../../packages/storage/src/lock-resources.ts';
import { canonical } from '../../packages/core/src/canonical.mjs';
import { hashPayload } from '../../packages/core/src/identity.ts';
import { stagingFixture, workspace, sql, metadataKey } from './staging-intents-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';

const fails = (fn, code) => assert.throws(fn, error => error.code === code);
const ownerPath = (f, owner) => join(f.directory, 'owners', owner + '.lock');
const state = f => ({ reservations: sql(f, 'SELECT * FROM storage_reservations ORDER BY reservation_id'),
  metadata: sql(f, 'SELECT value FROM meta WHERE key=?', metadataKey(f.request.reservation_id)) });
function abandoned(f) {
  const intent = f.coordinator.reserveStaging(f.b, f.request);
  fails(() => f.coordinator.close(), 'E_CAPABILITY');
  return intent;
}
function withRecovery(f, body) {
  const recovery = WorkspaceCoordinator.open(f.directory, workspace);
  try { return body(recovery); } finally { recovery.close(); }
}

test('Staging recovery: live owner stays held; closed foreign owner releases one pre-file charge', () => stagingFixture(f => {
  const intent = f.coordinator.reserveStaging(f.b, f.request);
  const before = f.coordinator.readStorageBudget().used_bytes;
  assert.equal(f.coordinator.recoverStaging(f.b, intent.reservation_id).state, 'held');
  assert.equal(f.coordinator.readStorageBudget().used_bytes, before);
  fails(() => f.coordinator.close(), 'E_CAPABILITY');

  const recovery = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    const result = recovery.recoverStaging(f.b, intent.reservation_id);
    assert.equal(result.state, 'cancelled');
    assert.equal(result.intent.state, 'cancelled');
    assert.equal(result.intent.owner_id, intent.owner_id);
    assert.equal(recovery.readStorageBudget().used_bytes, before - intent.max_bytes);
    assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations WHERE reservation_id=?', intent.reservation_id)[0].n, 0);
    assert.deepEqual(recovery.recoverStaging(f.b, intent.reservation_id), result);
  } finally { recovery.close(); }
}));

test('Staging recovery: API is strict and returned recovery and intent are deeply immutable', () => stagingFixture(f => {
  const intent = abandoned(f);
  withRecovery(f, recovery => {
    for (const id of [null, 'not-a-uuid', '00000000-0000-4000-8000-00000000000A']) {
      fails(() => recovery.recoverStaging(f.b, id), 'E_SCHEMA');
    }
    fails(() => recovery.recoverStaging({ ...f.b, incarnation: 'not-a-uuid' }, intent.reservation_id), 'E_SCHEMA');
    const result = recovery.recoverStaging(f.b, intent.reservation_id);
    assert.equal(result.state, 'cancelled');
    for (const value of [result, result.intent, result.intent.binding, result.intent.binding.scope]) assert.ok(Object.isFrozen(value));
    assert.throws(() => { result.state = 'held'; }, TypeError);
    assert.throws(() => { result.intent.binding.scope.workspace_id = 'changed'; }, TypeError);
    assert.equal(recovery.readStaging(f.b, intent.reservation_id).binding.scope.workspace_id, f.b.scope.workspace_id);
  });
}));

for (const failure of ['missing', 'replaced']) test(`Staging recovery: ${failure} owner file is E_CAPABILITY and preserves charge`, () => stagingFixture(f => {
  const intent = abandoned(f), path = ownerPath(f, intent.owner_id), before = state(f);
  if (failure === 'missing') unlinkSync(path);
  else {
    const saved = path + '.original';
    renameSync(path, saved); writeFileSync(path, '', { mode: 0o600 });
    try { withRecovery(f, recovery => fails(() => recovery.recoverStaging(f.b, intent.reservation_id), 'E_CAPABILITY')); }
    finally { unlinkSync(path); renameSync(saved, path); }
    assert.deepEqual(state(f), before); return;
  }
  withRecovery(f, recovery => fails(() => recovery.recoverStaging(f.b, intent.reservation_id), 'E_CAPABILITY'));
  assert.equal(existsSync(path), false); assert.deepEqual(state(f), before);
}));

for (const field of ['staging_path_key', 'blob_digest', 'kind']) test(`Staging recovery: non-pre-file ${field} fence preserves charge`, () => stagingFixture(f => {
  const intent = abandoned(f), before = state(f);
  sql(f, `UPDATE storage_reservations SET ${field}=? WHERE reservation_id=?`, field === 'kind' ? 'read_pin' : 'synthetic', intent.reservation_id);
  withRecovery(f, recovery => {
    fails(() => recovery.recoverStaging(f.b, intent.reservation_id), 'E_STORAGE');
    assert.equal(recovery.readStorageBudget().reserved_bytes, intent.max_bytes);
  });
  assert.equal(before.reservations[0].size_bytes, intent.max_bytes);
}));

test('Staging recovery: busy foreign owner lock remains held', () => stagingFixture(f => {
  const intent = abandoned(f), resources = LockResources.open(f.directory, false), held = resources.owner(intent.owner_id, false);
  try {
    assert.equal(held.tryLock(), true);
    withRecovery(f, recovery => assert.equal(recovery.recoverStaging(f.b, intent.reservation_id).state, 'held'));
    assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations WHERE reservation_id=?', intent.reservation_id)[0].n, 1);
  } finally { held.close(); resources.close(); }
}));

test('Staging recovery: exact envelope CAS rolls back reservation on concurrent envelope change', () => stagingFixture(f => {
  const intent = abandoned(f), before = state(f), prepare = DatabaseSync.prototype.prepare;
  let changed = 0;
  DatabaseSync.prototype.prepare = function(query) {
    const db = this;
    const statement = prepare.call(this, query);
    if (query.startsWith('DELETE FROM storage_reservations WHERE reservation_id=? AND owner_id=? AND operation_id=?')) {
      const run = statement.run;
      statement.run = function(...args) {
        const result = run.apply(this, args);
        const value = { ...intent, expected_policy_revision: 1 };
        changed++;
        prepare.call(db, 'UPDATE meta SET value=? WHERE key=?').run(canonical({ value, digest: hashPayload(value) }), metadataKey(intent.reservation_id));
        return result;
      };
    }
    return statement;
  };
  try { withRecovery(f, recovery => fails(() => recovery.recoverStaging(f.b, intent.reservation_id), 'E_CONFLICT')); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(changed, 1, 'STAGING_RECOVERY_EXACT_CAS'); assert.deepEqual(state(f), before);
}));

test('Staging recovery: inspection lock remains held at COMMIT and closes afterwards', () => stagingFixture(f => {
  const intent = abandoned(f);
  withRecovery(f, recovery => {
    const exec = DatabaseSync.prototype.exec; let observed = null;
    DatabaseSync.prototype.exec = function(query) { if (query === 'COMMIT') observed = pythonTry(ownerPath(f, intent.owner_id)); return exec.call(this, query); };
    try { assert.equal(recovery.recoverStaging(f.b, intent.reservation_id).state, 'cancelled'); }
    finally { DatabaseSync.prototype.exec = exec; }
    assert.equal(observed, 'busy', 'STAGING_RECOVERY_INSPECTION_COMMIT');
    assert.equal(pythonTry(ownerPath(f, intent.owner_id)), 'acquired');
  });
}));

for (const state of ['staging', 'complete', 'cleanup_pending']) test(`Staging recovery: ${state} managed file keeps reservation charged`, () => stagingFixture(f => {
  const intent = f.coordinator.reserveStaging(f.b, f.request);
  sql(f, 'INSERT INTO managed_files(path_key,kind,operation_id,state,scopes_json) VALUES (?,?,?,?,?)',
    `synthetic/${state}`, 'synthetic', intent.operation_id, state, '{}');
  const before = f.coordinator.readStorageBudget().used_bytes;
  fails(() => f.coordinator.close(), 'E_CAPABILITY');

  const recovery = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    fails(() => recovery.recoverStaging(f.b, intent.reservation_id), 'E_CONFLICT');
    assert.equal(recovery.readStorageBudget().used_bytes, before);
    assert.equal(recovery.readStaging(f.b, intent.reservation_id).state, 'reserved');
  } finally { recovery.close(); }
}));
