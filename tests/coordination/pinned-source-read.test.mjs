/** Real SQLite and kernel locks. All data are synthetic; run in GitHub Actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { createSessionBinding, hashSource } from '../../packages/core/src/index.ts';
import { MAX_INLINE_SOURCE_BYTES } from '../../packages/storage/src/source-records.ts';
import { pinFixture, workspace, id, sql, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
const blobSQL = 'SELECT * FROM sources WHERE session_key=? AND source_id=? AND revision=?';
const fails = (fn, code) => assert.throws(fn, e => e.code === code);
const read = f => f.coordinator.readPinnedSource(f.b, f.request.reservation_id);
function blobReads(action) {
  const original = DatabaseSync.prototype.prepare; let count = 0;
  DatabaseSync.prototype.prepare = function(q) {
    if (q === blobSQL) count++;
    return original.call(this, q);
  };
  try { action(); return count; } finally { DatabaseSync.prototype.prepare = original; }
}
const state = f => ({ sources: sql(f, 'SELECT * FROM sources'),
  reservations: sql(f, 'SELECT * FROM storage_reservations'),
  pins: sql(f, "SELECT * FROM meta WHERE key LIKE 'storage.source-pin.v1:%'"),
  sessions: sql(f, 'SELECT * FROM sessions'), attempts: sql(f, 'SELECT * FROM attempts') });

for (const kind of ['read_pin', 'export_pin']) {
  test(`Pinned read: ${kind} returns exact verified bytes without releasing its reservation`, () => pinFixture(f => {
    f.coordinator.pinSource(f.b, { ...f.request, kind }); const before = state(f);
    const source = read(f);
    assert.deepEqual(source.ref, f.source.ref); assert.deepEqual(Buffer.from(source.bytes), f.source.bytes);
    assert.equal(source.media_type, f.source.media_type); assert.deepEqual(source.native_refs, f.source.native_refs);
    assert.ok(Object.isFrozen(source)); assert.ok(Object.isFrozen(source.ref)); assert.ok(Object.isFrozen(source.native_refs));
    assert.deepEqual(state(f), before); assert.equal(f.coordinator.readSourcePin(f.b, f.request.reservation_id).state, 'active');
  }));
}

test('Pinned read: returned bytes are independent copies on every call', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request); const a = read(f), b = read(f);
  a.bytes.fill(0); assert.deepEqual(Buffer.from(b.bytes), f.source.bytes);
  assert.deepEqual(Buffer.from(read(f).bytes), f.source.bytes);
  assert.deepEqual(Buffer.from(sql(f, 'SELECT inline_bytes FROM sources')[0].inline_bytes), f.source.bytes);
}));

test('Pinned read: unknown and released pins cannot authorize byte access', () => pinFixture(f => {
  assert.equal(blobReads(() => fails(() => read(f), 'E_CONFLICT')), 0);
  f.coordinator.pinSource(f.b, f.request); f.coordinator.releaseSourcePin(f.b, f.request.reservation_id);
  assert.equal(blobReads(() => fails(() => read(f), 'E_CONFLICT')), 0);
  assert.equal(f.coordinator.readSourcePin(f.b, f.request.reservation_id).state, 'released');
}));

test('Pinned read: another participant may inspect metadata but cannot read through the pin', () => pinFixture(f => {
  const pin = f.coordinator.pinSource(f.b, f.request), other = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    assert.deepEqual(other.readSourcePin(f.b, pin.reservation_id), pin);
    assert.equal(blobReads(() => fails(() => other.readPinnedSource(f.b, pin.reservation_id), 'E_OWNER')), 0);
  } finally { other.close(); }
  assert.deepEqual(Buffer.from(read(f).bytes), f.source.bytes);
}));

test('Pinned read: changed policy refuses bytes but still permits explicit owner cleanup', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request); sql(f, 'UPDATE sessions SET policy_revision=1');
  assert.equal(blobReads(() => fails(() => read(f), 'E_CONFLICT')), 0);
  assert.equal(f.coordinator.releaseSourcePin(f.b, f.request.reservation_id), true);
}));

test('Pinned read: tombstone refuses byte access even with an intact active pin', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request); sql(f, 'INSERT INTO tombstones VALUES (?,?,?)', f.b.session_key, 'all', 'synthetic');
  assert.equal(blobReads(() => fails(() => read(f), 'E_SCOPE')), 0);
  assert.equal(f.coordinator.releaseSourcePin(f.b, f.request.reservation_id), true);
}));

for (const field of ['incarnation', 'host_epoch']) {
  test(`Pinned read: changed ${field} refuses the old session snapshot`, () => pinFixture(f => {
    f.coordinator.pinSource(f.b, f.request);
    sql(f, `UPDATE sessions SET ${field}=?`, field === 'host_epoch' ? 1 : id(222));
    assert.equal(blobReads(() => fails(() => read(f), 'E_SCOPE')), 0);
  }));
}

test('Pinned read: a foreign binding cannot consume a known reservation ID', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request);
  for (const scope of [{ ...f.b.scope, workspace_id: id(901) }, { ...f.b.scope, host_session_id: 'other' }]) {
    const binding = createSessionBinding(scope, f.b.incarnation, f.b.host_epoch);
    assert.equal(blobReads(() => fails(() => f.coordinator.readPinnedSource(binding, f.request.reservation_id), 'E_SCOPE')), 0);
  }
}));

test('Pinned read: same-length content corruption is rejected after a previous successful read', () => pinFixture(f => {
  const pin = f.coordinator.pinSource(f.b, f.request); read(f);
  const changed = Buffer.from(f.source.bytes); changed[0] ^= 1;
  sql(f, 'UPDATE sources SET inline_bytes=?', changed);
  assert.deepEqual(f.coordinator.readSourcePin(f.b, pin.reservation_id), pin, 'metadata alone is not byte integrity');
  assert.equal(blobReads(() => fails(() => read(f), 'E_SOURCE')), 1);
  sql(f, 'UPDATE sources SET inline_bytes=?', f.source.bytes);
  assert.deepEqual(Buffer.from(read(f).bytes), f.source.bytes);
}));

for (const availability of ['excluded', 'missing', 'deleted']) {
  test(`Pinned read: ${availability} source is refused without discarding its pin`, () => pinFixture(f => {
    f.coordinator.pinSource(f.b, f.request);
    sql(f, 'UPDATE sources SET availability=?,inline_bytes=NULL', availability);
    assert.equal(blobReads(() => fails(() => read(f), 'E_SOURCE')), 0);
    assert.equal(f.coordinator.readSourcePin(f.b, f.request.reservation_id).state, 'active');
    assert.equal(f.coordinator.releaseSourcePin(f.b, f.request.reservation_id), true);
  }));
}

test('Pinned read: inconsistent pin metadata is rejected before source materialization', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request); const key = metadataKey(f.request.reservation_id);
  const saved = sql(f, 'SELECT value FROM meta WHERE key=?', key)[0].value;
  const envelope = JSON.parse(saved); envelope.value.policy_revision++;
  sql(f, 'UPDATE meta SET value=? WHERE key=?', JSON.stringify(envelope), key);
  assert.equal(blobReads(() => fails(() => read(f), 'E_STORAGE')), 0);
  sql(f, 'UPDATE meta SET value=? WHERE key=?', saved, key);
}));

test('Pinned read: the inclusive inline bound is verified and oversized metadata never loads a BLOB', () => pinFixture(f => {
  const bytes = Buffer.alloc(MAX_INLINE_SOURCE_BYTES, 120), ref = { ...f.source.ref, digest: hashSource(bytes) };
  sql(f, 'UPDATE sources SET inline_bytes=?,size_bytes=?,digest=?', bytes, bytes.length, ref.digest);
  f.coordinator.pinSource(f.b, { ...f.request, source_ref: ref });
  assert.equal(blobReads(() => assert.deepEqual(Buffer.from(read(f).bytes), bytes)), 1);
  sql(f, 'UPDATE sources SET size_bytes=?', MAX_INLINE_SOURCE_BYTES + 1);
  assert.equal(blobReads(() => fails(() => read(f), 'E_SOURCE')), 0);
}));

test('Pinned read: SQLite read snapshot and real workspace exclusion cover byte access', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request);
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const transactions = []; let workspaceLock, ownerLock, loads = 0;
  DatabaseSync.prototype.exec = function(q) { transactions.push(q); return exec.call(this, q); };
  DatabaseSync.prototype.prepare = function(q) {
    const statement = prepare.call(this, q);
    if (q === blobSQL) { const get = statement.get; statement.get = function(...args) {
      loads++; workspaceLock = pythonTry(join(f.directory, 'workspace.lock'));
      ownerLock = pythonTry(join(f.directory, 'owners', f.coordinator.owner_id + '.lock'));
      return get.apply(this, args);
    }; }
    return statement;
  };
  let source;
  try { source = read(f); } finally { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec; }
  assert.deepEqual(transactions, ['BEGIN', 'COMMIT']); assert.equal(loads, 1);
  assert.equal(workspaceLock, 'busy'); assert.equal(ownerLock, 'busy');
  assert.deepEqual(Buffer.from(source.bytes), f.source.bytes);
  assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired');
}));

test('Pinned read: contention is rejected before opening a read transaction', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request); const other = WorkspaceCoordinator.open(f.directory, workspace);
  const exec = DatabaseSync.prototype.exec; let reads = 0, code;
  try { other.withWorkspaceLock(() => {
    DatabaseSync.prototype.exec = function(q) { if (q === 'BEGIN') reads++; return exec.call(this, q); };
    try { read(f); } catch (e) { code = e.code; } finally { DatabaseSync.prototype.exec = exec; }
  }); } finally { DatabaseSync.prototype.exec = exec; other.close(); }
  assert.equal(code, 'E_CONFLICT'); assert.equal(reads, 0); assert.deepEqual(Buffer.from(read(f).bytes), f.source.bytes);
}));

test('Pinned read: failed read commit returns no bytes and preserves the reservation', () => pinFixture(f => {
  const pin = f.coordinator.pinSource(f.b, f.request), before = state(f);
  const exec = DatabaseSync.prototype.exec; let failures = 0, returned = false, code;
  DatabaseSync.prototype.exec = function(q) { if (q === 'COMMIT') { failures++; throw Error('synthetic read commit failure'); } return exec.call(this, q); };
  try { read(f); returned = true; } catch (e) { code = e.code; } finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(code, 'E_STORAGE'); assert.equal(failures, 1); assert.equal(returned, false);
  assert.deepEqual(state(f), before); assert.deepEqual(f.coordinator.readSourcePin(f.b, pin.reservation_id), pin);
  assert.deepEqual(Buffer.from(read(f).bytes), f.source.bytes);
}));

test('Pinned read: reopening does not adopt an old participant pin', () => pinFixture(f => {
  const pin = f.coordinator.pinSource(f.b, f.request);
  fails(() => f.coordinator.close(), 'E_CAPABILITY');
  fails(() => read(f), 'E_OWNER');
  const other = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    assert.deepEqual(other.readSourcePin(f.b, pin.reservation_id), pin);
    fails(() => other.readPinnedSource(f.b, pin.reservation_id), 'E_OWNER');
  } finally { other.close(); }
  assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations')[0].n, 1);
}));
