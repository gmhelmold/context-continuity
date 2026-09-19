/** Issue #28: count actual source BLOBs returned by SQLite, not elapsed time. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteSessionStore, OWNER_LEASE_MS } from '../../packages/storage/src/index.ts';
import { createSessionBinding, hashSource, resolveConfig } from '../../packages/core/src/index.ts';
const id = n => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const workspace = { installation_id: id(1), workspace_id: id(2) };
const binding = createSessionBinding({ ...workspace, adapter_id: 'budget-fixture', host_session_id: 'A' }, id(3), 0);
const READ_BYTES = 4 * 1024 * 1024, READ_COUNT = 256;
const source = (n, size = 16384, revision = 0) => {
  const bytes = Buffer.alloc(size, n % 251);
  return { ref: { source_id: id(1000 + n), revision, digest: hashSource(bytes) }, bytes,
    native_refs: ['source-' + n], media_type: 'application/octet-stream' };
};
const observation = (sources, name = 'r', extra = {}) => ({ native_identity: name, authority: 'agent',
  protocol_group: name, completed: true, protected: false, native_refs: [name],
  source_refs: sources.map(s => s.ref), payload_ref: 'public:' + name,
  payload: [{ role: 'assistant', content: name }], estimated_tokens: 10, ...extra });
function fixture(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'cc-budget-')), handles = [];
  let now = 100000;
  const store = SqliteSessionStore.create(directory, workspace, () => now); handles.push(store);
  store.createSession(binding, resolveConfig({}, { context_window: 100000, output_reserve: 4096 }));
  const f = { store, lease: store.acquireLease(binding), catalog: store.readRootCatalog(binding),
    path: join(directory, 'ledger.sqlite'), advance: n => now += n,
    write(sources, observations) {
      f.catalog = f.store.retainRoots(f.lease, { expected_catalog_digest: f.catalog.catalog_digest, sources, observations });
      return f.catalog;
    },
    reopen() {
      f.store.releaseLease(f.lease); f.store.close();
      f.store = SqliteSessionStore.open(directory, workspace, () => now); handles.push(f.store);
      f.lease = f.store.acquireLease(binding);
    },
    sql(sql, ...args) {
      const db = new DatabaseSync(f.path);
      try { return db.prepare(sql).all(...args); } finally { db.close(); }
    },
  };
  try { fn(f); } finally { for (const h of handles) h.close(); rmSync(directory, { recursive: true, force: true }); }
}
function counted(run) {
  const prepare = DatabaseSync.prototype.prepare;
  const result = { reads: 0, bytes: 0, in_transaction: 0 };
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql), connection = this;
    if (/\bFROM\s+sources\b/i.test(sql)) {
      const record = row => {
        if (row) for (const value of Object.values(row)) if (value instanceof Uint8Array) {
          result.reads++; result.bytes += value.byteLength;
          if (connection.isTransaction) result.in_transaction++;
        }
        return row;
      };
      const get = statement.get, all = statement.all, iterate = statement.iterate;
      statement.get = function(...args) { return record(get.apply(this, args)); };
      statement.all = function(...args) { return all.apply(this, args).map(record); };
      statement.iterate = function*(...args) { for (const row of iterate.apply(this, args)) yield record(row); };
    }
    return statement;
  };
  try { run(); } finally { DatabaseSync.prototype.prepare = prepare; }
  return result;
}
function prime(f, count, size = 16384, roots = true) {
  const sources = Array.from({ length: count }, (_, n) => source(n, size));
  for (let start = 0; start < count; start += 8) {
    const chunk = sources.slice(start, start + 8);
    f.write(chunk, roots ? chunk.map(s => observation([s], s.native_refs[0])) : []);
  }
  return sources;
}
for (const size of [8, 32, 128]) {
  test(`I28: empty retention with ${size} roots reads no historical source bytes`, () => fixture(f => {
    prime(f, size); const before = f.catalog;
    const reads = counted(() => assert.deepEqual(f.write([], []), before));
    assert.deepEqual(reads, { reads: 0, bytes: 0, in_transaction: 0 });
    console.log('I28_MEASURE', JSON.stringify({ roots: size, operation: 'empty', ...reads }));
  }));
  test(`I28: one-source retention with ${size} roots reads only the submitted source`, () => fixture(f => {
    prime(f, size); const next = source(900);
    const reads = counted(() => f.write([next], [observation([next], 'new')]));
    assert.equal(reads.reads, 1); assert.equal(reads.bytes, next.bytes.length);
    assert.equal(reads.in_transaction, 1); assert.equal(f.catalog.entries.length, size + 1);
    console.log('I28_MEASURE', JSON.stringify({ roots: size, operation: 'append', ...reads }));
  }));
}
test('I28: replay, revision and metadata-only work is bounded to submitted references', () => fixture(f => {
  const sources = prime(f, 32), old = sources[0], root = observation([old], old.native_refs[0]);
  for (const extra of [{}, { estimated_tokens: 20 }, { payload: [{ role: 'assistant', content: 'revised' }] }]) {
    const reads = counted(() => f.write([old], [{ ...root, ...extra }]));
    assert.equal(reads.reads, 1); assert.equal(reads.bytes, old.bytes.length);
  }
}));
test('I28: shared sources are read once per operation, never once per root', () => fixture(f => {
  const [shared] = prime(f, 8);
  const reads = counted(() => f.write([shared], Array.from({ length: 64 }, (_, n) => observation([shared], 'shared-' + n))));
  assert.equal(reads.reads, 1); assert.equal(reads.bytes, shared.bytes.length);
}));
test('I28: a structural retention return does not attest unchanged content bytes', () => fixture(f => {
  const [old] = prime(f, 8), before = f.catalog;
  // Same-size changed content preserves metadata but must never be consumed as verified.
  f.sql('UPDATE sources SET inline_bytes=? WHERE source_id=?', Buffer.alloc(old.bytes.length, 255), old.ref.source_id);
  const fresh = source(900);
  f.write([fresh], [observation([fresh], 'new')]);
  assert.throws(() => f.store.readSource(binding, old.ref), e => e.code === 'E_SOURCE');
  assert.throws(() => f.store.readRoot(binding, before.entries[0].unit.root_coverage[0]), e => e.code === 'E_SOURCE');
  assert.throws(() => f.store.readRootCatalog(binding), e => e.code === 'E_SOURCE');
  assert.throws(() => f.write([], [observation([old], 'uses-corruption')]), e => e.code === 'E_SOURCE');
}));
test('I28: no verification survives another connection commit or reopen', () => fixture(f => {
  const [old] = prime(f, 8);
  for (const reopen of [false, true]) {
    f.sql('UPDATE sources SET inline_bytes=? WHERE source_id=?', old.bytes, old.ref.source_id);
    if (reopen) f.reopen();
    const root = observation([old], 'repeat');
    assert.equal(counted(() => f.write([], [root])).reads, 1);
    f.sql('UPDATE sources SET inline_bytes=? WHERE source_id=?', Buffer.alloc(old.bytes.length, 222), old.ref.source_id);
    assert.throws(() => f.write([], [root]), e => e.code === 'E_SOURCE');
  }
}));
test('I28: unavailable or contradictory metadata still rejects the whole index', () => fixture(f => {
  const [old] = prime(f, 8);
  f.sql("UPDATE sources SET availability='deleted',inline_bytes=NULL WHERE source_id=?", old.ref.source_id);
  const fresh = source(900);
  assert.throws(() => f.write([fresh], [observation([fresh], 'new')]), e => e.code === 'E_SOURCE');
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM sources WHERE source_id=?', fresh.ref.source_id)[0].n, 0);
}));
test('I28: byte budget stops before over-limit BLOB fetch and rolls back earlier inserts', () => fixture(f => {
  const sources = prime(f, 17, 256 * 1024, false), fresh = source(900, 1);
  const prior = f.sql("SELECT value FROM meta WHERE key='clock_high_water_ms'")[0].value;
  f.advance(10);
  const reads = counted(() => assert.throws(() => f.write([fresh], [observation(sources)]), e => e.code === 'E_BUDGET'));
  assert.ok(reads.bytes <= READ_BYTES); assert.ok(reads.reads <= READ_COUNT);
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM sources WHERE source_id=?', fresh.ref.source_id)[0].n, 0);
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM root_units')[0].n, 0);
  assert.equal(f.sql("SELECT value FROM meta WHERE key='clock_high_water_ms'")[0].value, prior);
}));
test('I28: exact byte budget is accepted without truncation', () => fixture(f => {
  const sources = prime(f, 16, 256 * 1024, false);
  const reads = counted(() => f.write([], [observation(sources)]));
  assert.equal(reads.bytes, READ_BYTES); assert.equal(reads.reads, 16);
}));
test('I28: zero-byte sources still have a finite distinct-read budget', () => fixture(f => {
  const sources = prime(f, READ_COUNT + 1, 0, false);
  const reads = counted(() => assert.throws(() => f.write([], [observation(sources)]), e => e.code === 'E_BUDGET'));
  assert.equal(reads.bytes, 0); assert.equal(reads.reads, READ_COUNT);
  assert.equal(f.sql('SELECT COUNT(*) AS n FROM root_units')[0].n, 0);
  assert.equal(counted(() => f.write([], [observation(sources.slice(0, READ_COUNT))])).reads, READ_COUNT);
}));
test('I28: inconsistent stored length is rejected before copying a source BLOB', () => fixture(f => {
  const [old] = prime(f, 1, 16, false);
  f.sql('UPDATE sources SET inline_bytes=? WHERE source_id=?', Buffer.alloc(512 * 1024, 1), old.ref.source_id);
  const reads = counted(() => assert.throws(() => f.write([], [observation([old])]), e => e.code === 'E_SOURCE'));
  assert.equal(reads.bytes, 0); assert.equal(reads.reads, 0);
}));
test('I28: stale catalog or expired ownership cannot trigger historical BLOB reads', () => fixture(f => {
  const before = f.catalog.catalog_digest; prime(f, 8);
  const a = counted(() => assert.throws(() => f.store.retainRoots(f.lease,
    { expected_catalog_digest: before, sources: [], observations: [] }), e => e.code === 'E_CONFLICT'));
  assert.equal(a.reads, 0);
  f.advance(OWNER_LEASE_MS);
  const b = counted(() => assert.throws(() => f.write([], []), e => e.code === 'E_OWNER'));
  assert.equal(b.reads, 0);
}));

test('I28: new source revision reads only new content and preserves historical references', () => fixture(f => {
  const [old] = prime(f, 32), previous = f.catalog.entries[0].unit.root_coverage[0];
  const next = source(0, 8192, 1);
  const reads = counted(() => f.write([next], [observation([next], old.native_refs[0])]));
  assert.equal(reads.reads, 1); assert.equal(reads.bytes, 8192);
  assert.equal(f.store.readRoot(binding, previous).revision, 0);
  assert.deepEqual(Buffer.from(f.store.readSource(binding, old.ref).bytes), old.bytes);
}));
test('I28: identical byte hashes with different source identities each require verification', () => fixture(f => {
  const first = source(0), second = { ...first, ref: { ...first.ref, source_id: id(9999) }, native_refs: ['other'] };
  const reads = counted(() => f.write([first, second], [observation([first, second])]));
  assert.equal(reads.reads, 2); assert.equal(reads.bytes, first.bytes.length * 2);
}));
test('I28: source policy changes are observed freshly without an inherited verification receipt', () => fixture(f => {
  const [old] = prime(f, 1);
  f.sql('UPDATE sources SET policy_revision=7 WHERE source_id=?', old.ref.source_id);
  assert.equal(counted(() => f.write([], [observation([old], 'new-root')])).reads, 1);
  assert.equal(f.store.readSource(binding, old.ref).policy_revision, 7);
  f.sql("UPDATE sources SET availability='excluded',inline_bytes=NULL WHERE source_id=?", old.ref.source_id);
  assert.throws(() => f.write([], []), e => e.code === 'E_SOURCE');
}));
