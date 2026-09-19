/** Real SQLite/locks; recovery is one reservation, never a process-death claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceCoordinator, StorageError } from '../../packages/storage/src/index.ts';
import { LockResources } from '../../packages/storage/src/lock-resources.ts';
import { createSessionBinding } from '../../packages/core/src/identity.ts';
import { pinFixture, workspace, id, sql, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
import { begin } from '../storage/job-fixtures.mjs';
const fails = (fn, code) => assert.throws(fn, error => error.code === code);
const ownerPath = (f, owner) => join(f.directory, 'owners', owner + '.lock');
const pinState = f => ({ rows: sql(f, 'SELECT * FROM storage_reservations ORDER BY reservation_id'),
  metadata: sql(f, 'SELECT value FROM meta WHERE key=?', metadataKey(f.request.reservation_id)) });
function abandoned(f, kind = f.request.kind) {
  const pin = f.coordinator.pinSource(f.b, { ...f.request, kind });
  fails(() => f.coordinator.close(), 'E_CAPABILITY');
  assert.equal(pythonTry(ownerPath(f, pin.owner_id)), 'acquired');
  return pin;
}
function withRecovery(f, body) {
  const coordinator = WorkspaceCoordinator.open(f.directory, workspace);
  try { return body(coordinator); } finally { coordinator.close(); }
}
const recover = (c, f) => c.recoverSourcePin(f.b, f.request.reservation_id);

for (const kind of ['read_pin', 'export_pin']) test(`Pin recovery: ${kind} releases only the requested reservation`, () => pinFixture(f => {
  const second = { ...f.request, reservation_id: id(301), kind: 'export_pin' };
  f.coordinator.pinSource(f.b, second);
  sql(f, 'INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,kind,size_bytes,created_at) VALUES (?,?,?,?,?,?)',
    id(302), f.coordinator.owner_id, id(303), 'staging', 123, 'synthetic');
  const pin = abandoned(f, kind), other = sql(f, 'SELECT * FROM storage_reservations WHERE reservation_id<>? ORDER BY reservation_id', pin.reservation_id);
  const { job } = begin(f); f.s.cancelJob(f.lease, job.ref);
  const preserved = Object.fromEntries(['sources','sessions','jobs','attempts','aux_runs','chapters','storage_owners'].map(t => [t, sql(f, `SELECT * FROM ${t}`)]));
  withRecovery(f, c => {
    // This new participant is unrelated to the old participant whose rows are checked below.
    const owners = sql(f, 'SELECT * FROM storage_owners');
    const result = recover(c, f);
    assert.equal(result.state, 'released'); assert.equal(result.pin.state, 'released');
    assert.equal(result.pin.owner_id, pin.owner_id); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.pin.source_ref));
    assert.deepEqual(sql(f, 'SELECT * FROM storage_reservations ORDER BY reservation_id'), other);
    for (const [table, rows] of Object.entries(preserved)) if (table !== 'storage_owners') assert.deepEqual(sql(f, `SELECT * FROM ${table}`), rows);
    assert.deepEqual(sql(f, 'SELECT * FROM storage_owners'), owners);
    assert.equal(c.readOwner(pin.owner_id).state, 'active');
    fails(() => c.retireOwner(pin.owner_id), 'E_CAPABILITY');
    assert.equal(pythonTry(ownerPath(f, pin.owner_id)), 'acquired', 'inspection descriptor must release its lock after commit');
    assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired');
  });
}));

test('Pin recovery: live original owner remains held regardless of elapsed session time', () => pinFixture(f => {
  const pin = f.coordinator.pinSource(f.b, f.request), before = pinState(f); f.advance(999999);
  withRecovery(f, c => {
    assert.equal(recover(c, f).state, 'held'); assert.deepEqual(pinState(f), before);
    assert.equal(pythonTry(ownerPath(f, pin.owner_id)), 'busy');
    assert.equal(f.coordinator.readPinnedSource(f.b, pin.reservation_id).bytes.byteLength, f.source.bytes.byteLength);
  });
}));
test('Pin recovery: current participant is held and normal owner release remains explicit', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request); const before = pinState(f);
  assert.equal(recover(f.coordinator, f).state, 'held'); assert.deepEqual(pinState(f), before);
  assert.equal(f.coordinator.releaseSourcePin(f.b, f.request.reservation_id), true);
}));
test('Pin recovery: unknown ID is not created or treated as released', () => pinFixture(f => {
  const before = pinState(f);
  fails(() => recover(f.coordinator, f), 'E_CONFLICT'); assert.deepEqual(pinState(f), before);
}));
test('Pin recovery: released replay is idempotent without reopening the old owner file', () => pinFixture(f => {
  const pin = abandoned(f);
  withRecovery(f, c => {
    const first = recover(c, f), before = pinState(f);
    unlinkSync(ownerPath(f, pin.owner_id));
    assert.deepEqual(recover(c, f), first); assert.deepEqual(pinState(f), before);
    assert.equal(existsSync(ownerPath(f, pin.owner_id)), false);
    fails(() => c.pinSource(f.b, f.request), 'E_OWNER');
  });
}));
test('Pin recovery: normal release still refuses another participant even after owner close', () => pinFixture(f => {
  abandoned(f); const before = pinState(f);
  withRecovery(f, c => { fails(() => c.releaseSourcePin(f.b, f.request.reservation_id), 'E_OWNER'); assert.deepEqual(pinState(f), before); });
}));
test('Pin recovery: binding and workspace mismatch never consume the reservation', () => pinFixture(f => {
  abandoned(f); const before = pinState(f);
  withRecovery(f, c => {
    for (const b of [createSessionBinding(f.b.scope, f.b.incarnation, 1),
      createSessionBinding({ ...f.b.scope, workspace_id: id(701) }, f.b.incarnation, 0)]) {
      fails(() => c.recoverSourcePin(b, f.request.reservation_id), 'E_SCOPE'); assert.deepEqual(pinState(f), before);
    }
  });
}));
test('Pin recovery: a missing original owner file is not recreated', () => pinFixture(f => {
  const pin = abandoned(f), path = ownerPath(f, pin.owner_id), before = pinState(f); unlinkSync(path);
  withRecovery(f, c => { fails(() => recover(c, f), 'E_CAPABILITY'); assert.equal(existsSync(path), false); assert.deepEqual(pinState(f), before); });
}));
test('Pin recovery: a different inode at the same pathname cannot authorize release', () => pinFixture(f => {
  const pin = abandoned(f), path = ownerPath(f, pin.owner_id), saved = path + '.original', before = pinState(f);
  renameSync(path, saved); writeFileSync(path, '', { mode: 0o600 });
  try { withRecovery(f, c => { fails(() => recover(c, f), 'E_CAPABILITY'); assert.deepEqual(pinState(f), before); }); }
  finally { unlinkSync(path); renameSync(saved, path); }
}));
test('Pin recovery: unsafe permissions refuse inspection without repair', () => pinFixture(f => {
  const pin = abandoned(f), path = ownerPath(f, pin.owner_id), before = pinState(f); chmodSync(path, 0o640);
  try { withRecovery(f, c => { fails(() => recover(c, f), 'E_CAPABILITY'); assert.deepEqual(pinState(f), before); }); }
  finally { chmodSync(path, 0o600); }
}));
test('Pin recovery: an active pin with retired owner is inconsistent rather than eligible', () => pinFixture(f => {
  const pin = abandoned(f); sql(f, "UPDATE storage_owners SET state='retired' WHERE owner_id=?", pin.owner_id); const before = pinState(f);
  withRecovery(f, c => { fails(() => recover(c, f), 'E_STORAGE'); assert.deepEqual(pinState(f), before); });
}));
test('Pin recovery: malformed owner metadata prevents release', () => pinFixture(f => {
  const pin = abandoned(f); sql(f, 'UPDATE meta SET value=? WHERE key=?', '{}', 'coordinator.owner.v1:' + pin.owner_id); const before = pinState(f);
  withRecovery(f, c => { fails(() => recover(c, f), 'E_CAPABILITY'); assert.deepEqual(pinState(f), before); });
}));
test('Pin recovery: malformed pin digest cannot be used as cleanup authority', () => pinFixture(f => {
  abandoned(f); const key = metadataKey(f.request.reservation_id), e = JSON.parse(sql(f, 'SELECT value FROM meta WHERE key=?', key)[0].value);
  e.digest = '0'.repeat(64); sql(f, 'UPDATE meta SET value=? WHERE key=?', JSON.stringify(e), key); const before = pinState(f);
  withRecovery(f, c => { fails(() => recover(c, f), 'E_STORAGE'); assert.deepEqual(pinState(f), before); });
}));
for (const missing of ['metadata','reservation']) test(`Pin recovery: incomplete ${missing} pair is not silently reconciled`, () => pinFixture(f => {
  abandoned(f);
  if (missing === 'metadata') sql(f, 'DELETE FROM meta WHERE key=?', metadataKey(f.request.reservation_id));
  else sql(f, 'DELETE FROM storage_reservations WHERE reservation_id=?', f.request.reservation_id);
  const before = pinState(f);
  withRecovery(f, c => { fails(() => recover(c, f), 'E_STORAGE'); assert.deepEqual(pinState(f), before); });
}));
test('Pin recovery: deletion and current policy never resurrect source content during cleanup', () => pinFixture(f => {
  abandoned(f);
  sql(f, "UPDATE sources SET availability='deleted',inline_bytes=NULL,blob_key=NULL WHERE session_key=?", f.b.session_key);
  sql(f, 'UPDATE sessions SET policy_revision=9,host_epoch=1 WHERE session_key=?', f.b.session_key);
  sql(f, 'INSERT INTO tombstones VALUES (?,?,?)', f.b.session_key, 'all', 'synthetic');
  const before = sql(f, 'SELECT * FROM sources');
  withRecovery(f, c => { assert.equal(recover(c, f).state, 'released'); assert.deepEqual(sql(f, 'SELECT * FROM sources'), before); });
}));
test('Pin recovery: contended workspace refuses before beginning a SQLite write', () => pinFixture(f => {
  abandoned(f);
  withRecovery(f, c => {
    const locker = WorkspaceCoordinator.open(f.directory, workspace), exec = DatabaseSync.prototype.exec; let writes = 0;
    DatabaseSync.prototype.exec = function(q) { if (q === 'BEGIN IMMEDIATE') writes++; return exec.call(this, q); };
    try { locker.withWorkspaceLock(() => fails(() => recover(c, f), 'E_CONFLICT')); }
    finally { DatabaseSync.prototype.exec = exec; locker.close(); }
    assert.equal(writes, 0);
  });
}));
test('Pin recovery: metadata failure rolls back the deleted reservation', () => pinFixture(f => {
  abandoned(f);
  withRecovery(f, c => {
    const before = pinState(f), prepare = DatabaseSync.prototype.prepare; let writes = 0;
    DatabaseSync.prototype.prepare = function(q) {
      if (q === 'UPDATE meta SET value=? WHERE key=? AND value=?') { writes++; throw Error('synthetic pin metadata failure'); }
      return prepare.call(this, q);
    };
    try { fails(() => recover(c, f), 'E_STORAGE'); } finally { DatabaseSync.prototype.prepare = prepare; }
    assert.equal(writes, 1); assert.deepEqual(pinState(f), before); assert.equal(recover(c, f).state, 'released');
  });
}));
test('Pin recovery: COMMIT refusal rolls back both reservation and released metadata', () => pinFixture(f => {
  const pin = abandoned(f);
  withRecovery(f, c => {
    const before = pinState(f), exec = DatabaseSync.prototype.exec; let commits = 0;
    DatabaseSync.prototype.exec = function(q) { if (q === 'COMMIT') { commits++; throw Error('synthetic pin commit failure'); } return exec.call(this, q); };
    try { fails(() => recover(c, f), 'E_STORAGE'); } finally { DatabaseSync.prototype.exec = exec; }
    assert.equal(commits, 1); assert.deepEqual(pinState(f), before); assert.equal(pythonTry(ownerPath(f, pin.owner_id)), 'acquired');
    assert.equal(recover(c, f).state, 'released');
  });
}));
test('Pin recovery: inspection lock remains held at COMMIT and is closed afterwards', () => pinFixture(f => {
  const pin = abandoned(f);
  withRecovery(f, c => {
    const exec = DatabaseSync.prototype.exec; let observed = null;
    DatabaseSync.prototype.exec = function(q) { if (q === 'COMMIT') observed = pythonTry(ownerPath(f, pin.owner_id)); return exec.call(this, q); };
    try { assert.equal(recover(c, f).state, 'released'); } finally { DatabaseSync.prototype.exec = exec; }
    assert.equal(observed, 'busy'); assert.equal(pythonTry(ownerPath(f, pin.owner_id)), 'acquired');
  });
}));
test('Pin recovery: final identity guard rolls back replacement during the transaction', () => pinFixture(f => {
  const pin = abandoned(f), path = ownerPath(f, pin.owner_id), saved = path + '.original';
  withRecovery(f, c => {
    const before = pinState(f), prepare = DatabaseSync.prototype.prepare; let changed = false;
    DatabaseSync.prototype.prepare = function(q) {
      const stmt = prepare.call(this, q);
      if (q === 'DELETE FROM storage_reservations WHERE reservation_id=? AND owner_id=?') {
        const run = stmt.run; stmt.run = function(...args) { const result = run.apply(this, args); renameSync(path, saved); writeFileSync(path, '', { mode: 0o600 }); changed = true; return result; };
      } return stmt;
    };
    try { fails(() => recover(c, f), 'E_CAPABILITY'); }
    finally { DatabaseSync.prototype.prepare = prepare; if (changed) { unlinkSync(path); renameSync(saved, path); } }
    assert.equal(changed, true); assert.deepEqual(pinState(f), before); assert.equal(recover(c, f).state, 'released');
  });
}));
test('Pin recovery: error after real unlock has an idempotent durable result', () => pinFixture(f => {
  abandoned(f);
  withRecovery(f, c => {
    const release = LockResources.prototype.release; let releases = 0;
    LockResources.prototype.release = function() { release.call(this); releases++; throw new StorageError('E_CAPABILITY', 'synthetic post-commit unlock error'); };
    try { fails(() => recover(c, f), 'E_CAPABILITY'); } finally { LockResources.prototype.release = release; }
    assert.equal(releases, 1); const state = pinState(f);
    assert.equal(state.rows.length, 0); assert.equal(JSON.parse(state.metadata[0].value).value.state, 'released');
    assert.equal(recover(c, f).state, 'released'); assert.deepEqual(pinState(f), state);
  });
}));
test('Pin recovery: releasing the last pin permits only a separate explicit owner retirement', () => pinFixture(f => {
  const pin = abandoned(f);
  withRecovery(f, c => {
    assert.equal(recover(c, f).state, 'released'); assert.equal(c.readOwner(pin.owner_id).state, 'active');
    assert.equal(c.retireOwner(pin.owner_id).state, 'retired');
    assert.equal(existsSync(ownerPath(f, pin.owner_id)), true);
  });
}));
