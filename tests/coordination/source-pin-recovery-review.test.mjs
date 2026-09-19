/** E3 integration review: real SQLite and kernel locks; synthetic data only.
 * These tests run in GitHub Actions, not against an installed user workspace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { pinFixture, workspace, id, sql, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';

const ownerPath = (f, owner) => join(f.directory, 'owners', owner + '.lock');
function abandon(f) {
  const pin = f.coordinator.pinSource(f.b, f.request);
  assert.throws(() => f.coordinator.close(), e => e.code === 'E_CAPABILITY');
  assert.equal(pythonTry(ownerPath(f, pin.owner_id)), 'acquired');
  return pin;
}
const pinRows = f => ({
  reservations: sql(f, 'SELECT * FROM storage_reservations ORDER BY reservation_id'),
  metadata: sql(f, 'SELECT value FROM meta WHERE key=?', metadataKey(f.request.reservation_id)),
});

test('Pin recovery review: cleanup never reads or repairs unrelated source content', () => pinFixture(f => {
  abandon(f);
  // Damage only the synthetic BLOB without changing its size. Metadata recovery
  // must neither authenticate those bytes nor make their inconsistency disappear.
  sql(f, 'UPDATE sources SET inline_bytes=zeroblob(size_bytes) WHERE session_key=?', f.b.session_key);
  const sources = sql(f, 'SELECT * FROM sources');
  const c = WorkspaceCoordinator.open(f.directory, workspace);
  const prepare = DatabaseSync.prototype.prepare;
  let contentReads = 0;
  try {
    DatabaseSync.prototype.prepare = function(query) {
      if (/\b(?:FROM|JOIN)\s+(?:main\.)?(?:sources|root_units)\b/i.test(query)) contentReads++;
      return prepare.call(this, query);
    };
    try { assert.equal(c.recoverSourcePin(f.b, f.request.reservation_id).state, 'released'); }
    finally { DatabaseSync.prototype.prepare = prepare; }
    assert.equal(contentReads, 0, 'recovering an identified metadata pin must not scan source bytes or roots');
    assert.deepEqual(sql(f, 'SELECT * FROM sources'), sources);
    assert.throws(() => f.s.readSource(f.b, f.source.ref), e => e.code === 'E_SOURCE');
  } finally { DatabaseSync.prototype.prepare = prepare; c.close(); }
}));

test('Pin recovery review: recovering an old pin preserves another live participant and its reader', () => pinFixture(f => {
  const old = abandon(f);
  const live = WorkspaceCoordinator.open(f.directory, workspace);
  const c = WorkspaceCoordinator.open(f.directory, workspace);
  const request = { ...f.request, reservation_id: id(711), operation_id: id(712), kind: 'export_pin' };
  let livePin;
  try {
    livePin = live.pinSource(f.b, request);
    const liveRows = sql(f, 'SELECT * FROM storage_reservations WHERE reservation_id=?', request.reservation_id);
    const liveMetadata = sql(f, 'SELECT value FROM meta WHERE key=?', metadataKey(request.reservation_id));
    const owners = sql(f, 'SELECT * FROM storage_owners ORDER BY owner_id');
    assert.equal(c.recoverSourcePin(f.b, old.reservation_id).state, 'released');
    assert.equal(c.recoverSourcePin(f.b, request.reservation_id).state, 'held');
    assert.deepEqual(sql(f, 'SELECT * FROM storage_reservations WHERE reservation_id=?', request.reservation_id), liveRows);
    assert.deepEqual(sql(f, 'SELECT value FROM meta WHERE key=?', metadataKey(request.reservation_id)), liveMetadata);
    assert.deepEqual(sql(f, 'SELECT * FROM storage_owners ORDER BY owner_id'), owners);
    assert.equal(pythonTry(ownerPath(f, live.owner_id)), 'busy');
    assert.deepEqual(Buffer.from(live.readPinnedSource(f.b, request.reservation_id).bytes), Buffer.from(f.source.bytes));
    assert.equal(live.readSourcePin(f.b, request.reservation_id).state, 'active');
  } finally {
    c.close();
    try { if (livePin) live.releaseSourcePin(f.b, request.reservation_id); }
    finally { live.close(); }
  }
}));

test('Pin recovery review: failed rollback poisons only the connection and releases both inspection locks', () => pinFixture(f => {
  const pin = abandon(f);
  const c = WorkspaceCoordinator.open(f.directory, workspace);
  const before = pinRows(f);
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  let metadataFailures = 0, rollbackFailures = 0;
  try {
    DatabaseSync.prototype.prepare = function(query) {
      if (query === 'UPDATE meta SET value=? WHERE key=? AND value=?') {
        metadataFailures++;
        throw Error('synthetic recovery metadata failure');
      }
      return prepare.call(this, query);
    };
    DatabaseSync.prototype.exec = function(query) {
      if (query === 'ROLLBACK') {
        rollbackFailures++;
        throw Error('synthetic recovery rollback failure');
      }
      return exec.call(this, query);
    };
    try {
      assert.throws(() => c.recoverSourcePin(f.b, pin.reservation_id),
        e => e.code === 'E_STORAGE' && e.message.includes('rollback'));
    } finally {
      DatabaseSync.prototype.prepare = prepare;
      DatabaseSync.prototype.exec = exec;
    }
    assert.equal(metadataFailures, 1);
    assert.equal(rollbackFailures, 1);
    assert.deepEqual(pinRows(f), before, 'closing the poisoned SQLite connection must not publish the partial release');
    assert.equal(pythonTry(ownerPath(f, pin.owner_id)), 'acquired', 'failed transaction must release the original-owner inspection');
    assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired', 'failed transaction must release workspace exclusion');
    assert.throws(() => c.recoverSourcePin(f.b, pin.reservation_id), e => e.code === 'E_STORAGE');
    const fresh = WorkspaceCoordinator.open(f.directory, workspace);
    try {
      assert.equal(fresh.readSourcePin(f.b, pin.reservation_id).state, 'active');
      assert.equal(fresh.recoverSourcePin(f.b, pin.reservation_id).state, 'released');
      assert.equal(fresh.recoverSourcePin(f.b, pin.reservation_id).state, 'released');
    } finally { fresh.close(); }
  } finally {
    DatabaseSync.prototype.prepare = prepare;
    DatabaseSync.prototype.exec = exec;
    // The poisoned coordinator still revokes and closes its remaining resources.
    try { c.close(); } catch (e) { if (e.code !== 'E_STORAGE') throw e; }
  }
}));
