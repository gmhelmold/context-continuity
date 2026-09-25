/** SPEC-24 behavior. Real SQLite/locks only; run this suite in GitHub Actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceCoordinator, StorageError, WORKSPACE_CONTENT_QUOTA_BYTES as QUOTA,
  MAX_ACTIVE_STAGING_INTENTS, MAX_STAGING_INTENT_BYTES } from '../../packages/storage/src/index.ts';
import { createSessionBinding, hashSource } from '../../packages/core/src/index.ts';
import { LockResources } from '../../packages/storage/src/lock-resources.ts';
import { stagingFixture, workspace, id, sql, metadataKey } from './staging-intents-fixtures.mjs';

const fails = (fn, code, marker) => assert.throws(fn, error => error.code === code, marker);
const stage = (f, n = 101, patch = {}) => f.coordinator.reserveStaging(f.b, {
  ...f.request, ...(n === 101 ? {} : { reservation_id: id(n), operation_id: id(n + 1000) }), ...patch,
});
const snapshot = f => Object.fromEntries(['storage_reservations', 'meta', 'storage_owners', 'sources', 'blobs',
  'sessions', 'jobs', 'attempts', 'aux_runs', 'chapters', 'managed_files', 'views']
  .map(table => [table, sql(f, `SELECT * FROM ${table} ORDER BY rowid`)]));
function fillTo(f, remaining) {
  const used = f.coordinator.readStorageBudget().used_bytes, bytes = QUOTA - used - remaining;
  assert.ok(bytes >= 0);
  sql(f, "INSERT INTO blobs(digest,size_bytes,created_at) VALUES (?,?,?)", 'f'.repeat(64), bytes, '2026-01-01T00:00:00.000Z');
}
function retainByte(f, binding, lease, n) {
  const bytes = Buffer.from('x');
  const source = { ref: { source_id: id(n), revision: 0, digest: hashSource(bytes) }, native_refs: ['staging-' + n],
    media_type: 'application/octet-stream', bytes };
  return f.s.retainRoots(lease, { expected_catalog_digest: f.s.readRootCatalog(binding).catalog_digest, sources: [source], observations: [] });
}

test('Staging intents: reserve records exact immutable pre-file capacity without side effects', () => stagingFixture(f => {
  const before = snapshot(f), intent = stage(f);
  assert.equal(intent.state, 'reserved'); assert.equal(intent.max_bytes, 1); assert.equal(intent.policy_revision, 0);
  assert.deepEqual(intent.binding, f.b); assert.equal(intent.owner_id, f.coordinator.owner_id);
  assert.ok(Object.isFrozen(intent)); assert.ok(Object.isFrozen(intent.binding)); assert.ok(Object.isFrozen(intent.binding.scope));
  assert.throws(() => { intent.max_bytes = 2; }, TypeError);
  const row = sql(f, 'SELECT * FROM storage_reservations WHERE reservation_id=?', intent.reservation_id)[0];
  assert.deepEqual({ kind: row.kind, size_bytes: row.size_bytes, staging_path_key: row.staging_path_key, blob_digest: row.blob_digest },
    { kind: 'staging', size_bytes: 1, staging_path_key: null, blob_digest: null });
  const envelope = JSON.parse(sql(f, 'SELECT value FROM meta WHERE key=?', metadataKey(intent.reservation_id))[0].value);
  assert.deepEqual(envelope.value, intent); assert.equal(typeof envelope.digest, 'string');
  for (const table of ['jobs', 'attempts', 'aux_runs', 'chapters', 'managed_files']) assert.equal(snapshot(f)[table].length, before[table].length);
  assert.equal(f.coordinator.readStaging(f.b, intent.reservation_id).state, 'reserved');
}));

test('Staging intents: request is strict, getters stay inert, and byte limits are inclusive', () => stagingFixture(f => {
  for (const bytes of [1, MAX_STAGING_INTENT_BYTES]) {
    const intent = stage(f, 200 + bytes, { max_bytes: bytes });
    assert.equal(intent.max_bytes, bytes); assert.equal(f.coordinator.cancelStaging(f.b, intent.reservation_id), true);
  }
  let reads = 0; const getter = { ...f.request };
  Object.defineProperty(getter, 'max_bytes', { enumerable: true, get() { reads++; return 1; } });
  for (const request of [{ ...f.request, max_bytes: 0 }, { ...f.request, max_bytes: MAX_STAGING_INTENT_BYTES + 1 },
    { ...f.request, max_bytes: 1.5 }, { ...f.request, extra: true }, getter]) fails(() => f.coordinator.reserveStaging(f.b, request), 'E_SCHEMA');
  assert.equal(reads, 0); assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations')[0].n, 0);
}));

test('Staging intents: scope incarnation epoch tombstone and expected policy gate new admission', () => stagingFixture(f => {
  const foreign = createSessionBinding({ ...f.b.scope, host_session_id: 'stage-other' }, f.b.incarnation, f.b.host_epoch);
  fails(() => f.coordinator.reserveStaging(foreign, f.request), 'E_SCOPE');
  const otherWorkspace = createSessionBinding({ ...f.b.scope, workspace_id: id(998) }, f.b.incarnation, f.b.host_epoch);
  fails(() => f.coordinator.reserveStaging(otherWorkspace, f.request), 'E_SCOPE');
  for (const binding of [createSessionBinding(f.b.scope, id(999), 0), createSessionBinding(f.b.scope, f.b.incarnation, 1)]) {
    fails(() => f.coordinator.reserveStaging(binding, f.request), 'E_SCOPE');
  }
  fails(() => f.coordinator.reserveStaging(f.b, { ...f.request, expected_policy_revision: 1 }), 'E_CONFLICT');
  sql(f, 'INSERT INTO tombstones(scope_hash,identity,reason) VALUES (?,?,?)', f.b.session_key, 'all', 'synthetic');
  fails(() => f.coordinator.reserveStaging(f.b, f.request), 'E_SCOPE');
  assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations')[0].n, 0);
}));

test('Staging intents: exact replay preserves timestamp and charge, changed input or cancellation cannot replay', () => stagingFixture(f => {
  const first = stage(f), before = f.coordinator.readStorageBudget();
  const second = f.coordinator.reserveStaging(f.b, f.request);
  assert.deepEqual(second, first); assert.equal(f.coordinator.readStorageBudget().reserved_bytes, before.reserved_bytes, 'STAGING_REPLAY_NO_CHARGE');
  for (const patch of [{ operation_id: id(900) }, { max_bytes: 2 }, { expected_policy_revision: 1 }]) {
    fails(() => f.coordinator.reserveStaging(f.b, { ...f.request, ...patch }), 'E_CONFLICT');
  }
  sql(f, 'UPDATE sessions SET policy_revision=1 WHERE session_key=?', f.b.session_key);
  fails(() => f.coordinator.reserveStaging(f.b, f.request), 'E_CONFLICT', 'STAGING_REPLAY_POLICY');
  assert.equal(f.coordinator.cancelStaging(f.b, first.reservation_id), true);
  assert.equal(f.coordinator.cancelStaging(f.b, first.reservation_id), false);
  fails(() => f.coordinator.reserveStaging(f.b, { ...f.request, expected_policy_revision: 1 }), 'E_CONFLICT');
}));

test('Staging intents: cancelled history remains readable after original owner retirement', () => stagingFixture(f => {
  const intent = stage(f); assert.equal(f.coordinator.cancelStaging(f.b, intent.reservation_id), true);
  f.coordinator.close();
  const reader = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    assert.equal(reader.readStaging(f.b, intent.reservation_id).state, 'cancelled');
    assert.equal(reader.readOwner(intent.owner_id).state, 'retired');
  } finally { reader.close(); }
}));

test('Staging intents: tombstone after reserve cannot block original cancellation', () => stagingFixture(f => {
  const intent = stage(f); sql(f, 'INSERT INTO tombstones(scope_hash,identity,reason) VALUES (?,?,?)', f.b.session_key, 'all', 'synthetic');
  assert.equal(f.coordinator.cancelStaging(f.b, intent.reservation_id), true);
}));

test('Staging intents: original active owner alone can replay or cancel', () => stagingFixture(f => {
  const intent = stage(f), other = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    assert.deepEqual(other.readStaging(f.b, intent.reservation_id), intent);
    fails(() => other.reserveStaging(f.b, f.request), 'E_OWNER', 'STAGING_OWNER_GATE');
    fails(() => other.cancelStaging(f.b, intent.reservation_id), 'E_OWNER', 'STAGING_OWNER_GATE');
  } finally { other.close(); }
  assert.equal(f.coordinator.cancelStaging(f.b, intent.reservation_id), true);
}));

for (const corruption of ['missing-envelope', 'missing-row', 'row-bytes', 'owner-instance', 'owner-retired']) {
  test(`Staging intents: ${corruption} is storage corruption, never empty capacity`, () => stagingFixture(f => {
    const intent = stage(f), key = metadataKey(intent.reservation_id);
    if (corruption === 'missing-envelope') sql(f, 'DELETE FROM meta WHERE key=?', key);
    if (corruption === 'missing-row') sql(f, 'DELETE FROM storage_reservations WHERE reservation_id=?', intent.reservation_id);
    if (corruption === 'row-bytes') sql(f, 'UPDATE storage_reservations SET size_bytes=2 WHERE reservation_id=?', intent.reservation_id);
    if (corruption === 'owner-instance') sql(f, 'UPDATE storage_owners SET process_instance=? WHERE owner_id=?', id(777), intent.owner_id);
    if (corruption === 'owner-retired') sql(f, "UPDATE storage_owners SET state='retired' WHERE owner_id=?", intent.owner_id);
    if (['owner-instance', 'owner-retired'].includes(corruption)) {
      const reader = WorkspaceCoordinator.open(f.directory, workspace);
      try { fails(() => reader.readStaging(f.b, intent.reservation_id), 'E_STORAGE'); }
      finally { reader.close(); }
    } else fails(() => f.coordinator.readStaging(f.b, intent.reservation_id), 'E_STORAGE');
  }));
}

for (const value of [Buffer.from('{}'), '{"digest":"x","value":{}}\0']) {
  test('Staging intents: non-text and NUL metadata never become an intent', () => stagingFixture(f => {
    const intent = stage(f), key = metadataKey(intent.reservation_id);
    sql(f, 'UPDATE meta SET value=? WHERE key=?', value, key);
    fails(() => f.coordinator.readStaging(f.b, intent.reservation_id), 'E_STORAGE');
  }));
}

for (const corruption of ['noncanonical', 'digest']) {
  test(`Staging intents: ${corruption} envelope is never accepted`, () => stagingFixture(f => {
    const intent = stage(f), key = metadataKey(intent.reservation_id), original = sql(f, 'SELECT value FROM meta WHERE key=?', key)[0].value;
    const value = corruption === 'noncanonical' ? original + ' ' : JSON.stringify({ ...JSON.parse(original), digest: '0'.repeat(64) });
    sql(f, 'UPDATE meta SET value=? WHERE key=?', value, key);
    fails(() => f.coordinator.readStaging(f.b, intent.reservation_id), 'E_STORAGE');
  }));
}

test('Staging intents: oversized metadata is refused before value materialization', () => stagingFixture(f => {
  const intent = stage(f), key = metadataKey(intent.reservation_id), original = sql(f, 'SELECT value FROM meta WHERE key=?', key)[0].value;
  sql(f, 'UPDATE meta SET value=? WHERE key=?', original + ' '.repeat(16385 - Buffer.byteLength(original)), key);
  const prepare = DatabaseSync.prototype.prepare; let values = 0, scalar = 0;
  try {
    DatabaseSync.prototype.prepare = function(query) {
      const statement = prepare.call(this, query);
      if (query === 'SELECT value FROM meta WHERE key=?') { const get = statement.get; statement.get = function(...args) { if (args[0] === key) values++; return get.apply(this, args); }; }
      if (query.includes('octet_length(value)')) { const get = statement.get; statement.get = function(...args) { if (args[0] === key) scalar++; return get.apply(this, args); }; }
      return statement;
    };
    fails(() => f.coordinator.readStaging(f.b, intent.reservation_id), 'E_STORAGE');
  } finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(scalar, 1); assert.equal(values, 0, 'STAGING_METADATA_PREMATERIALIZATION');
}));

for (const state of ['staging', 'complete', 'cleanup_pending']) {
  test(`Staging intents: ${state} managed file blocks pre-file cancellation`, () => stagingFixture(f => {
    const intent = stage(f);
    sql(f, 'INSERT INTO managed_files(path_key,kind,operation_id,state,scopes_json) VALUES (?,?,?,?,?)',
      `synthetic/${state}`, 'staging', intent.operation_id, state, '[]');
    fails(() => f.coordinator.cancelStaging(f.b, intent.reservation_id), 'E_CONFLICT', 'STAGING_MANAGED_FILE_FENCE');
    assert.equal(f.coordinator.readStaging(f.b, intent.reservation_id).state, 'reserved');
  }));
}

for (const field of ['staging_path_key', 'blob_digest']) {
  test(`Staging intents: non-null ${field} prevents cancellation and preserves charge`, () => stagingFixture(f => {
    const intent = stage(f); sql(f, `UPDATE storage_reservations SET ${field}=? WHERE reservation_id=?`, 'synthetic', intent.reservation_id);
    fails(() => f.coordinator.cancelStaging(f.b, intent.reservation_id), 'E_STORAGE');
    assert.equal(f.coordinator.readStorageBudget().reserved_bytes, intent.max_bytes);
  }));
}

test('Staging intents: managed operation also blocks reserve and exact replay', () => stagingFixture(f => {
  sql(f, 'INSERT INTO managed_files(path_key,kind,operation_id,state,scopes_json) VALUES (?,?,?,?,?)',
    'synthetic/reserve', 'staging', f.request.operation_id, 'staging', '[]');
  fails(() => f.coordinator.reserveStaging(f.b, f.request), 'E_CONFLICT', 'STAGING_MANAGED_FILE_FENCE');
  assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations')[0].n, 0);
}));

test('Staging intents: active count is inclusive and replay does not consume another slot', () => stagingFixture(f => {
  const db = new DatabaseSync(f.path);
  try {
    db.exec('BEGIN IMMEDIATE'); const insert = db.prepare(`INSERT INTO storage_reservations
      (reservation_id,owner_id,operation_id,kind,size_bytes,created_at) VALUES (?,?,?,'staging',1,'synthetic')`);
    for (let n = 0; n < MAX_ACTIVE_STAGING_INTENTS - 1; n++) insert.run(id(10000 + n), f.coordinator.owner_id, id(20000 + n));
    db.exec('COMMIT');
  } finally { db.close(); }
  const intent = stage(f); assert.deepEqual(f.coordinator.reserveStaging(f.b, f.request), intent);
  fails(() => stage(f, 30000), 'E_BUDGET');
}));

test('Staging intents: shared quota competes with inline retention in both directions and sessions', () => stagingFixture(f => {
  const second = createSessionBinding({ ...f.b.scope, host_session_id: 'staging-second' }, f.b.incarnation, 0);
  f.s.createSession(second, f.cfg); const lease = f.s.acquireLease(second);
  fillTo(f, 1); const first = stage(f);
  fails(() => retainByte(f, second, lease, 601), 'E_BUDGET', 'STAGING_QUOTA_GATE');
  assert.equal(f.coordinator.cancelStaging(f.b, first.reservation_id), true);
  assert.equal(retainByte(f, second, lease, 601).entries.length, 1);
  fails(() => stage(f, 602), 'E_BUDGET', 'STAGING_QUOTA_GATE');
}));

test('Staging intents: failed insertion cancellation and COMMIT preserve atomic reservation state', () => stagingFixture(f => {
  const original = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(query) {
    if (query === 'INSERT INTO meta(key,value) VALUES (?,?)') throw Error('synthetic staging insert failure');
    return original.call(this, query);
  };
  try { fails(() => stage(f), 'E_STORAGE'); } finally { DatabaseSync.prototype.prepare = original; }
  assert.equal(f.coordinator.readStaging(f.b, f.request.reservation_id), null);
  const intent = stage(f), before = f.coordinator.readStorageBudget();
  DatabaseSync.prototype.prepare = function(query) {
    if (query === 'UPDATE meta SET value=? WHERE key=? AND value=?') throw Error('synthetic staging cancellation failure');
    return original.call(this, query);
  };
  try { fails(() => f.coordinator.cancelStaging(f.b, intent.reservation_id), 'E_STORAGE'); } finally { DatabaseSync.prototype.prepare = original; }
  assert.deepEqual(f.coordinator.readStaging(f.b, intent.reservation_id), intent); assert.equal(f.coordinator.readStorageBudget().reserved_bytes, before.reserved_bytes);
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(query) { if (query === 'COMMIT') throw Error('synthetic staging COMMIT failure'); return exec.call(this, query); };
  try { fails(() => f.coordinator.cancelStaging(f.b, intent.reservation_id), 'E_STORAGE'); } finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(f.coordinator.readStaging(f.b, intent.reservation_id).state, 'reserved');
}));

test('Staging intents: error after committed cancellation reports no false resurrection', () => stagingFixture(f => {
  const intent = stage(f), release = LockResources.prototype.release; let releases = 0;
  LockResources.prototype.release = function() { release.call(this); releases++; throw new StorageError('E_CAPABILITY', 'synthetic post-commit unlock failure'); };
  try { fails(() => f.coordinator.cancelStaging(f.b, intent.reservation_id), 'E_CAPABILITY'); }
  finally { LockResources.prototype.release = release; }
  assert.equal(releases, 1); assert.equal(f.coordinator.readStaging(f.b, intent.reservation_id).state, 'cancelled');
  assert.equal(f.coordinator.cancelStaging(f.b, intent.reservation_id), false);
}));

test('Staging intents: error after committed reservation reports existing immutable charge', () => stagingFixture(f => {
  const release = LockResources.prototype.release; let releases = 0;
  LockResources.prototype.release = function() { release.call(this); releases++; throw new StorageError('E_CAPABILITY', 'synthetic post-commit unlock failure'); };
  try { fails(() => stage(f), 'E_CAPABILITY'); } finally { LockResources.prototype.release = release; }
  assert.equal(releases, 1); assert.equal(f.coordinator.readStaging(f.b, f.request.reservation_id).state, 'reserved');
  assert.equal(f.coordinator.readStorageBudget().reserved_bytes, 1);
}));

for (const state of ['reserved', 'cancelled']) {
  test(`Staging intents: ${state} history blocks source-pin admission without reading foreign payload`, () => stagingFixture(f => {
    const intent = stage(f); if (state === 'cancelled') assert.equal(f.coordinator.cancelStaging(f.b, intent.reservation_id), true);
    const before = snapshot(f);
    fails(() => f.coordinator.pinSource(f.b, { reservation_id: intent.reservation_id, operation_id: id(700), kind: 'read_pin', source_ref: f.source.ref }), 'E_CONFLICT', 'STAGING_CROSS_KIND_FENCE');
    assert.deepEqual(snapshot(f), before);
  }));
}
for (const state of ['active', 'released']) {
  test(`Staging intents: ${state} source-pin history blocks same reservation ID`, () => stagingFixture(f => {
    const pin = f.coordinator.pinSource(f.b, { reservation_id: f.request.reservation_id, operation_id: id(701), kind: 'read_pin', source_ref: f.source.ref });
    if (state === 'released') assert.equal(f.coordinator.releaseSourcePin(f.b, pin.reservation_id), true);
    const before = snapshot(f);
    fails(() => f.coordinator.reserveStaging(f.b, f.request), 'E_CONFLICT', 'STAGING_CROSS_KIND_FENCE');
    assert.deepEqual(snapshot(f), before);
  }));
}
