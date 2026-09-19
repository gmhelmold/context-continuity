/** Real SQLite/locks, synthetic data. Execute only in GitHub Actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceCoordinator, MAX_SOURCE_PIN_PAGE_SIZE, StorageError } from '../../packages/storage/src/index.ts';
import { LockResources } from '../../packages/storage/src/lock-resources.ts';
import { createSessionBinding, hashPayload } from '../../packages/core/src/identity.ts';
import { canonical } from '../../packages/core/src/canonical.mjs';
import { pinFixture, workspace, id, sql, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
import { binding } from '../storage/job-fixtures.mjs';

const isPageQuery = q => q.startsWith('SELECT reservation_id FROM storage_reservations');
const ids = page => page.pins.map(p => p.reservation_id);
const fail = (fn, code) => assert.throws(fn, e => e.code === code);
function page(c, options = { limit: 2 }) {
  let result;
  assert.doesNotThrow(() => { result = c.listSourcePins(options); });
  return result;
}
function pin(f, n, c = f.coordinator, b = f.b) {
  return c.pinSource(b, { ...f.request, reservation_id: id(n), operation_id: id(n + 1000), kind: n % 2 ? 'read_pin' : 'export_pin' });
}
function snapshot(f) {
  return Object.fromEntries(['storage_reservations', 'meta', 'storage_owners', 'sources', 'sessions', 'jobs', 'attempts', 'aux_runs', 'chapters']
    .map(t => [t, sql(f, `SELECT * FROM ${t} ORDER BY rowid`)]));
}
function rewritePin(f, n, transform) {
  const key = metadataKey(id(n)), saved = sql(f, 'SELECT value FROM meta WHERE key=?', key)[0].value;
  const original = JSON.parse(saved), value = transform(original.value);
  sql(f, 'UPDATE meta SET value=? WHERE key=?', canonical({ value, digest: hashPayload(value) }), key);
  return () => sql(f, 'UPDATE meta SET value=? WHERE key=?', saved, key);
}

test('Pin discovery: empty workspace yields an immutable terminal page without writes', () => pinFixture(f => {
  const before = snapshot(f), result = page(f.coordinator);
  assert.deepEqual(result, { pins: [], next_after: null });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.pins));
  assert.deepEqual(snapshot(f), before);
}));

test('Pin discovery: keyset pages are ordered without duplicates or skipped lookahead', () => pinFixture(f => {
  for (const n of [105, 101, 104, 102, 103]) pin(f, n);
  const first = page(f.coordinator), second = page(f.coordinator, { limit: 2, after: first.next_after });
  const last = page(f.coordinator, { limit: 2, after: second.next_after });
  assert.deepEqual(ids(first), [id(101), id(102)]); assert.equal(first.next_after, id(102));
  assert.deepEqual(ids(second), [id(103), id(104)]); assert.equal(second.next_after, id(104));
  assert.deepEqual(ids(last), [id(105)]); assert.equal(last.next_after, null);
  assert.deepEqual(page(f.coordinator, { limit: 2, after: id(999) }), { pins: [], next_after: null });
}));

test('Pin discovery: released history and staging are not active source candidates', () => pinFixture(f => {
  pin(f, 101); pin(f, 102); f.coordinator.releaseSourcePin(f.b, id(101));
  sql(f, 'INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,kind,size_bytes,created_at) VALUES (?,?,?,?,?,?)',
    id(100), f.coordinator.owner_id, id(900), 'staging', 123, 'synthetic');
  const before = snapshot(f);
  assert.deepEqual(ids(page(f.coordinator)), [id(102)]);
  assert.deepEqual(snapshot(f), before);
}));

test('Pin discovery: maximum page size is inclusive and validates only one lookahead', () => pinFixture(f => {
  assert.equal(MAX_SOURCE_PIN_PAGE_SIZE, 64);
  for (let n = 100; n < 166; n++) pin(f, n);
  const prepare = DatabaseSync.prototype.prepare;
  let fetched = 0, selectedLimit = null, pinReads = 0;
  DatabaseSync.prototype.prepare = function(q) {
    const s = prepare.call(this, q);
    if (isPageQuery(q)) {
      const all = s.all; s.all = function(...args) { selectedLimit = args[1]; const rows = all.apply(this, args); fetched += rows.length; return rows; };
    }
    if (q === 'SELECT value FROM meta WHERE key=?') {
      const get = s.get; s.get = function(...args) { if (String(args[0]).startsWith('storage.source-pin.v1:')) pinReads++; return get.apply(this, args); };
    }
    return s;
  };
  let first;
  try { first = page(f.coordinator, { limit: 64 }); } finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(selectedLimit, 65); assert.equal(fetched, 65); assert.equal(pinReads, 65);
  assert.equal(first.pins.length, 64); assert.equal(first.next_after, id(163));
  assert.deepEqual(ids(page(f.coordinator, { limit: 64, after: first.next_after })), [id(164), id(165)]);
}));

test('Pin discovery: malformed bounds and cursors are refused before any transaction', () => pinFixture(f => {
  const bad = [null, {}, { limit: 0 }, { limit: 65 }, { limit: -1 }, { limit: 1.5 }, { limit: NaN }, { limit: '2' },
    { limit: 2, after: '' }, { limit: 2, after: null }, { limit: 2, after: id(100).toUpperCase().replace('0000', 'ABCD') },
    { limit: 2, owner_id: id(4) }, { limit: 2, after: {} }];
  const exec = DatabaseSync.prototype.exec; let begun = 0, getters = 0;
  DatabaseSync.prototype.exec = function(q) { if (q.startsWith('BEGIN')) begun++; return exec.call(this, q); };
  try {
    for (const value of bad) assert.throws(() => f.coordinator.listSourcePins(value));
    assert.throws(() => f.coordinator.listSourcePins({ get limit() { getters++; return 2; } }));
  } finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(begun, 0); assert.equal(getters, 0);
}));

test('Pin discovery: returned metadata is deeply immutable and grants no foreign read authority', () => pinFixture(f => {
  const saved = pin(f, 101), other = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    const result = page(other).pins[0]; assert.deepEqual(result, saved);
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.binding));
    assert.ok(Object.isFrozen(result.binding.scope)); assert.ok(Object.isFrozen(result.source_ref));
    fail(() => other.readPinnedSource(result.binding, result.reservation_id), 'E_OWNER');
    assert.equal(other.recoverSourcePin(result.binding, result.reservation_id).state, 'held');
    assert.deepEqual(f.coordinator.readSourcePin(f.b, id(101)), saved);
  } finally { other.close(); }
}));

test('Pin discovery: multiple sessions and original epochs remain discoverable after policy changes', () => pinFixture(f => {
  pin(f, 101);
  const b = binding('second'); f.s.createSession(b, f.cfg);
  const lease = f.s.acquireLease(b);
  f.s.retainRoots(lease, { expected_catalog_digest: f.s.readRootCatalog(b).catalog_digest, sources: [f.source], observations: [] });
  pin(f, 102, f.coordinator, b);
  sql(f, 'UPDATE sessions SET host_epoch=1,policy_revision=7 WHERE session_key=?', f.b.session_key);
  sql(f, 'INSERT INTO tombstones VALUES (?,?,?)', f.b.session_key, 'all', 'synthetic');
  const result = page(f.coordinator);
  assert.deepEqual(result.pins.map(p => p.binding), [f.b, b]);
  fail(() => f.coordinator.readPinnedSource(f.b, id(101)), 'E_SCOPE');
  assert.equal(f.coordinator.releaseSourcePin(f.b, id(101)), true);
}));

test('Pin discovery: deleting a returned cursor does not offset or skip the next page', () => pinFixture(f => {
  for (const n of [101, 102, 103, 104]) pin(f, n);
  const first = page(f.coordinator);
  for (const p of first.pins) f.coordinator.releaseSourcePin(p.binding, p.reservation_id);
  const second = page(f.coordinator, { limit: 2, after: first.next_after });
  assert.deepEqual(ids(second), [id(103), id(104)]); assert.equal(second.next_after, null);
}));

test('Pin discovery: concurrent page changes have explicit keyset rather than frozen-scan semantics', () => pinFixture(f => {
  pin(f, 101); pin(f, 104); pin(f, 108);
  const first = page(f.coordinator, { limit: 1 });
  pin(f, 100); pin(f, 103); f.coordinator.releaseSourcePin(f.b, id(104));
  assert.deepEqual(ids(page(f.coordinator, { limit: 4, after: first.next_after })), [id(103), id(108)]);
  assert.deepEqual(ids(page(f.coordinator, { limit: 4 })), [id(100), id(101), id(103), id(108)]);
}));

for (const n of [101, 102]) test(`Pin discovery: invalid digest in selected or lookahead record ${n} refuses the whole page`, () => pinFixture(f => {
  pin(f, 101); pin(f, 102);
  const key = metadataKey(id(n)), saved = sql(f, 'SELECT value FROM meta WHERE key=?', key)[0].value;
  sql(f, 'UPDATE meta SET value=? WHERE key=?', JSON.stringify({ ...JSON.parse(saved), digest: '0'.repeat(64) }), key);
  try { fail(() => f.coordinator.listSourcePins({ limit: 1 }), 'E_STORAGE'); }
  finally { sql(f, 'UPDATE meta SET value=? WHERE key=?', saved, key); }
  assert.deepEqual(ids(page(f.coordinator, { limit: 1 })), [id(101)]);
}));

test('Pin discovery: missing metadata is an error rather than an omitted active reservation', () => pinFixture(f => {
  pin(f, 101); sql(f, 'DELETE FROM meta WHERE key=?', metadataKey(id(101)));
  fail(() => f.coordinator.listSourcePins({ limit: 1 }), 'E_STORAGE');
  assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations')[0].n, 1);
}));

test('Pin discovery: malformed persisted identifier is not interpreted as a caller error', () => pinFixture(f => {
  sql(f, 'INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,kind,size_bytes,created_at) VALUES (?,?,?,?,?,?)',
    'broken-id', f.coordinator.owner_id, id(900), 'read_pin', 0, 'synthetic');
  fail(() => f.coordinator.listSourcePins({ limit: 1 }), 'E_STORAGE');
}));

test('Pin discovery: foreign workspace in a self-consistent envelope is refused', () => pinFixture(f => {
  pin(f, 101);
  const foreign = createSessionBinding({ ...f.b.scope, workspace_id: id(999) }, f.b.incarnation, f.b.host_epoch);
  const restore = rewritePin(f, 101, p => ({ ...p, binding: foreign }));
  sql(f, 'UPDATE storage_reservations SET session_key=? WHERE reservation_id=?', foreign.session_key, id(101));
  try { fail(() => f.coordinator.listSourcePins({ limit: 1 }), 'E_STORAGE'); }
  finally { restore(); sql(f, 'UPDATE storage_reservations SET session_key=? WHERE reservation_id=?', f.b.session_key, id(101)); }
}));

test('Pin discovery: an active pin with a retired original participant is not silently accepted', () => pinFixture(f => {
  const p = pin(f, 101), reader = WorkspaceCoordinator.open(f.directory, workspace);
  sql(f, "UPDATE storage_owners SET state='retired' WHERE owner_id=?", p.owner_id);
  try { fail(() => reader.listSourcePins({ limit: 1 }), 'E_STORAGE'); }
  finally { sql(f, "UPDATE storage_owners SET state='active' WHERE owner_id=?", p.owner_id); reader.close(); }
}));

test('Pin discovery: discovery uses only a read transaction and never accesses source payloads', () => pinFixture(f => {
  pin(f, 101); sql(f, 'UPDATE sources SET inline_bytes=zeroblob(size_bytes)');
  const before = snapshot(f), prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const transactions = []; let contents = 0;
  DatabaseSync.prototype.exec = function(q) { if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q)) transactions.push(q); return exec.call(this, q); };
  DatabaseSync.prototype.prepare = function(q) { if (/\b(?:FROM|JOIN)\s+(?:main\.)?(?:sources|root_units)\b/i.test(q)) contents++; return prepare.call(this, q); };
  try { assert.deepEqual(ids(page(f.coordinator)), [id(101)]); }
  finally { DatabaseSync.prototype.exec = exec; DatabaseSync.prototype.prepare = prepare; }
  assert.deepEqual(transactions, ['BEGIN', 'COMMIT']); assert.equal(contents, 0);
  assert.deepEqual(snapshot(f), before); fail(() => f.s.readSource(f.b, f.source.ref), 'E_SOURCE');
}));

test('Pin discovery: lock contention is refused before beginning the read transaction', () => pinFixture(f => {
  pin(f, 101); const other = WorkspaceCoordinator.open(f.directory, workspace);
  const exec = DatabaseSync.prototype.exec; let began = 0;
  DatabaseSync.prototype.exec = function(q) { if (q.startsWith('BEGIN')) began++; return exec.call(this, q); };
  try { f.coordinator.withWorkspaceLock(() => fail(() => other.listSourcePins({ limit: 1 }), 'E_CONFLICT')); }
  finally { DatabaseSync.prototype.exec = exec; other.close(); }
  assert.equal(began, 0);
}));

test('Pin discovery: row selection and metadata share one SQLite snapshot', () => pinFixture(f => {
  const original = pin(f, 101), prepare = DatabaseSync.prototype.prepare; let changed = 0;
  DatabaseSync.prototype.prepare = function(q) {
    const s = prepare.call(this, q);
    if (isPageQuery(q)) {
      const all = s.all;
      s.all = function(...args) {
        const rows = all.apply(this, args), db = new DatabaseSync(f.path);
        const value = { ...original, operation_id: id(999) };
        try {
          db.exec('BEGIN IMMEDIATE');
          prepare.call(db, 'UPDATE storage_reservations SET operation_id=? WHERE reservation_id=?').run(value.operation_id, original.reservation_id);
          prepare.call(db, 'UPDATE meta SET value=? WHERE key=?').run(canonical({ value, digest: hashPayload(value) }), metadataKey(original.reservation_id));
          db.exec('COMMIT'); changed++;
        } finally { db.close(); }
        return rows;
      };
    }
    return s;
  };
  let observed;
  try { observed = page(f.coordinator).pins[0]; } finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(changed, 1); assert.deepEqual(observed, original);
  assert.equal(page(f.coordinator).pins[0].operation_id, id(999));
}));

test('Pin discovery: failed read COMMIT returns no page and preserves reservations', () => pinFixture(f => {
  pin(f, 101); const before = snapshot(f), exec = DatabaseSync.prototype.exec; let commits = 0;
  DatabaseSync.prototype.exec = function(q) { if (q === 'COMMIT') { commits++; throw Error('synthetic discovery commit failure'); } return exec.call(this, q); };
  try { fail(() => f.coordinator.listSourcePins({ limit: 1 }), 'E_STORAGE'); }
  finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(commits, 1); assert.deepEqual(snapshot(f), before);
  assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired');
  assert.deepEqual(ids(page(f.coordinator)), [id(101)]);
}));

test('Pin discovery: failed final resource guard prevents returning a page', () => pinFixture(f => {
  pin(f, 101); const prepare = DatabaseSync.prototype.prepare; let changed = 0;
  DatabaseSync.prototype.prepare = function(q) {
    const s = prepare.call(this, q);
    if (isPageQuery(q)) { const all = s.all; s.all = function(...args) { const rows = all.apply(this, args); chmodSync(f.directory, 0o755); changed++; return rows; }; }
    return s;
  };
  try {
    assert.throws(() => f.coordinator.listSourcePins({ limit: 1 }),
      e => e.code === 'E_STORAGE' && e.message.includes('workspace directory must be private'));
  } finally { DatabaseSync.prototype.prepare = prepare; chmodSync(f.directory, 0o700); }
  assert.equal(changed, 1); assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired');
  assert.deepEqual(ids(page(f.coordinator)), [id(101)]);
}));

test('Pin discovery: failed real unlock returns no page and mutates no storage records', () => pinFixture(f => {
  pin(f, 101); const before = snapshot(f), release = LockResources.prototype.release; let calls = 0;
  LockResources.prototype.release = function() { release.call(this); calls++; throw new StorageError('E_CAPABILITY', 'synthetic discovery unlock failure'); };
  try { fail(() => f.coordinator.listSourcePins({ limit: 1 }), 'E_CAPABILITY'); }
  finally { LockResources.prototype.release = release; }
  assert.equal(calls, 1); assert.deepEqual(snapshot(f), before);
  assert.deepEqual(ids(page(f.coordinator)), [id(101)]);
}));

test('Pin discovery: a fresh participant discovers and explicitly recovers an old pin', () => pinFixture(f => {
  const original = pin(f, 101); fail(() => f.coordinator.close(), 'E_CAPABILITY');
  const reader = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    const before = snapshot(f), discovered = page(reader).pins[0];
    assert.deepEqual(discovered, original); assert.deepEqual(snapshot(f), before);
    assert.equal(reader.recoverSourcePin(discovered.binding, discovered.reservation_id).state, 'released');
    assert.deepEqual(page(reader), { pins: [], next_after: null });
    assert.equal(reader.readOwner(original.owner_id).state, 'active');
  } finally { reader.close(); }
  fail(() => f.coordinator.listSourcePins({ limit: 1 }), 'E_OWNER');
}));
