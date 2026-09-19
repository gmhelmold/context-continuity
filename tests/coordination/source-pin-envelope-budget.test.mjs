/** Real SQLite/locks with bounded synthetic fixtures. Execute only in GitHub Actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { loadSourcePin } from '../../packages/storage/src/source-pins.ts';
import { pinFixture, workspace, id, sql, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';
import { binding } from '../storage/job-fixtures.mjs';

const LIMIT = 16384; // Normative limit, deliberately not imported from the implementation.
const prefix = 'storage.source-pin.v1:';
const reject = fn => assert.throws(fn, e => e.code === 'E_STORAGE' &&
  e.reason === 'source pin records inconsistent' && e.message === 'storage: source pin records inconsistent');
const readText = (f, key) => sql(f, 'SELECT value FROM meta WHERE key=?', key)[0].value;
// Test-only byte witness: TEXT conversion in the pinned driver can stop at NUL.
const readBytes = (f, key) => Buffer.from(sql(f, 'SELECT CAST(value AS BLOB) AS bytes FROM meta WHERE key=?', key)[0].bytes);
const writeText = (f, key, value) => sql(f, 'UPDATE meta SET value=? WHERE key=?', value, key);
const padded = (text, bytes) => text + ' '.repeat(bytes - Buffer.byteLength(text));
function snapshot(f) {
  return Object.fromEntries(['storage_reservations', 'meta', 'storage_owners', 'sources', 'sessions', 'jobs', 'attempts', 'aux_runs', 'chapters']
    .map(table => [table, sql(f, `SELECT * FROM ${table} ORDER BY rowid`)]));
}
function addPin(f, n) {
  return f.coordinator.pinSource(f.b, { ...f.request, reservation_id: id(n), operation_id: id(n + 1000) });
}
/** Observe actual driver results, not an implementation-reported byte counter.
 * No query/result is replaced; an optional barrier runs after a real scalar read. */
function observe(run, afterProbe = () => {}) {
  const prepare = DatabaseSync.prototype.prepare, trace = { probes: [], values: [], transactions: [] };
  DatabaseSync.prototype.prepare = function(query) {
    const statement = prepare.call(this, query), connection = this;
    if (!/\bFROM\s+meta\b/i.test(query)) return statement;
    const get = statement.get;
    statement.get = function(...args) {
      const row = get.apply(this, args);
      if (typeof args[0] !== 'string' || !args[0].startsWith(prefix)) return row;
      trace.transactions.push(connection.isTransaction);
      if (row && Object.hasOwn(row, 'value')) {
        const value = row.value;
        trace.values.push({ key: args[0], bytes: typeof value === 'string' ? Buffer.byteLength(value) : value?.byteLength });
      }
      if (row && Object.hasOwn(row, 'size_bytes')) {
        trace.probes.push({ key: args[0], bytes: row.size_bytes, type: row.storage_type });
        afterProbe(args[0], row);
      }
      return row;
    };
    return statement;
  };
  try { return run(trace); } finally { DatabaseSync.prototype.prepare = prepare; }
}
function notMaterialized(trace, key) {
  assert.equal(trace.values.filter(row => row.key === key).length, 0, 'PIN_METADATA_PREMATERIALIZATION');
  assert.ok(trace.probes.some(row => row.key === key), 'a real scalar preflight must have run');
  assert.ok(trace.transactions.every(Boolean), 'all pin reads must belong to a transaction');
}
const calls = [
  ['by-id', f => f.coordinator.readSourcePin(f.b, id(101))],
  ['selected-page', f => f.coordinator.listSourcePins({ limit: 1 })],
  ['lookahead', f => f.coordinator.listSourcePins({ limit: 1 })],
  ['pinned-bytes', f => f.coordinator.readPinnedSource(f.b, id(101))],
  ['admission-replay', f => f.coordinator.pinSource(f.b, f.request)],
  ['release', f => f.coordinator.releaseSourcePin(f.b, id(101))],
  ['recovery', f => f.reader.recoverSourcePin(f.b, id(101))],
];
for (const [name, call] of calls) {
  test(`Pin envelope budget: ${name} refuses excess bytes before materialization`, () => pinFixture(f => {
    const original = f.coordinator.pinSource(f.b, f.request);
    addPin(f, 102);
    const reader = WorkspaceCoordinator.open(f.directory, workspace);
    const key = metadataKey(id(name === 'lookahead' ? 102 : 101)), saved = readText(f, key);
    writeText(f, key, padded(saved, LIMIT + 1));
    const before = snapshot(f);
    try {
      observe(trace => {
        let returned;
        reject(() => { returned = call({ ...f, reader }); });
        assert.equal(returned, undefined);
        notMaterialized(trace, key);
        assert.equal(trace.values.length, name === 'lookahead' ? 1 : 0);
      });
      assert.deepEqual(snapshot(f), before);
      assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired');
      assert.equal(pythonTry(join(f.directory, 'owners', f.coordinator.owner_id + '.lock')), 'busy');
      assert.equal(pythonTry(join(f.directory, 'owners', reader.owner_id + '.lock')), 'busy');
    } finally { writeText(f, key, saved); reader.close(); }
    assert.deepEqual(f.coordinator.readSourcePin(f.b, id(101)), original);
    assert.equal(f.coordinator.recoverSourcePin(f.b, id(101)).state, 'held');
  }));
}

const corruptions = [
  ['multibyte', '"' + 'é'.repeat(8192) + '"'],
  ['astral', '"' + '🧭'.repeat(4096) + '"'],
  ['embedded-NUL', '{}\0' + ' '.repeat(LIMIT)],
];
for (const [name, value] of corruptions) {
  test(`Pin envelope budget: ${name} is counted in bytes before materialization`, () => pinFixture(f => {
    f.coordinator.pinSource(f.b, f.request);
    const key = metadataKey(id(101)), saved = readText(f, key);
    assert.ok(Buffer.byteLength(value) > LIMIT);
    writeText(f, key, value);
    try {
      assert.deepEqual(readBytes(f, key), Buffer.from(value), 'fixture retains all inserted bytes');
      const lengths = sql(f, 'SELECT length(value) AS characters, octet_length(value) AS bytes FROM meta WHERE key=?', key)[0];
      assert.ok(lengths.characters < LIMIT); assert.equal(lengths.bytes, Buffer.byteLength(value));
      observe(trace => { reject(() => f.coordinator.listSourcePins({ limit: 1 })); notMaterialized(trace, key); });
      assert.deepEqual(readBytes(f, key), Buffer.from(value), 'refusal must not repair the stored bytes');
    } finally { writeText(f, key, saved); }
  }));
}

for (const variant of ['bounded', 'exact-limit']) {
  test(`Pin envelope budget: ${variant} NUL suffix cannot turn a valid prefix into a complete record`, () => pinFixture(f => {
    const original = f.coordinator.pinSource(f.b, f.request), key = metadataKey(id(101)), saved = readText(f, key);
    const value = variant === 'bounded' ? saved + '\0synthetic' : padded(saved + '\0', LIMIT);
    assert.ok(Buffer.byteLength(value) <= LIMIT);
    if (variant === 'exact-limit') assert.equal(Buffer.byteLength(value), LIMIT);
    writeText(f, key, value);
    try {
      assert.deepEqual(readBytes(f, key), Buffer.from(value));
      const before = snapshot(f);
      observe(trace => {
        for (const call of [() => f.coordinator.readSourcePin(f.b, id(101)), () => f.coordinator.listSourcePins({ limit: 1 })]) {
          let returned;
          assert.throws(() => { returned = call(); }, e => e.code === 'E_STORAGE' &&
            e.reason === 'source pin records inconsistent' && e.message === 'storage: source pin records inconsistent',
            'PIN_METADATA_TEXT_COMPLETENESS');
          assert.equal(returned, undefined);
        }
        assert.deepEqual(trace.probes.map(row => row.bytes), [Buffer.byteLength(value), Buffer.byteLength(value)]);
        // Neither a truncating driver nor a future complete transfer may authorize this invalid JSON.
        assert.equal(trace.values.length, 2);
        assert.ok(trace.values.every(row => row.bytes <= Buffer.byteLength(value)));
        assert.ok(trace.transactions.every(Boolean));
      });
      assert.deepEqual(snapshot(f), before);
      assert.deepEqual(readBytes(f, key), Buffer.from(value));
      assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired');
      assert.equal(pythonTry(join(f.directory, 'owners', f.coordinator.owner_id + '.lock')), 'busy');
    } finally { writeText(f, key, saved); }
    assert.deepEqual(f.coordinator.readSourcePin(f.b, id(101)), original);
  }));
}

test('Pin envelope budget: a BLOB representation is refused without transferring its value', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request);
  const key = metadataKey(id(101)), saved = readText(f, key), blob = Buffer.from(saved);
  assert.ok(blob.byteLength < LIMIT);
  writeText(f, key, blob);
  try {
    observe(trace => {
      reject(() => f.coordinator.readSourcePin(f.b, id(101)));
      notMaterialized(trace, key); assert.equal(trace.probes[0].type, 'blob');
    });
    assert.deepEqual(Buffer.from(readText(f, key)), blob);
  } finally { writeText(f, key, saved); }
}));

for (const size of [LIMIT - 1, LIMIT]) {
  test(`Pin envelope budget: ${size} UTF-8 bytes remain readable`, () => pinFixture(f => {
    const b = binding('synthetic-é-🧭');
    f.s.createSession(b, f.cfg);
    const lease = f.s.acquireLease(b);
    f.s.retainRoots(lease, { expected_catalog_digest: f.s.readRootCatalog(b).catalog_digest, sources: [f.source], observations: [] });
    const original = f.coordinator.pinSource(b, f.request), key = metadataKey(id(101)), saved = readText(f, key);
    const text = padded(saved, size); assert.equal(Buffer.byteLength(text), size); assert.ok(text.length < size);
    writeText(f, key, text);
    try {
      observe(trace => {
        let found, page;
        assert.doesNotThrow(() => {
          found = f.coordinator.readSourcePin(b, id(101)); page = f.coordinator.listSourcePins({ limit: 1 });
        }, 'PIN_METADATA_INCLUSIVE_BOUND');
        assert.deepEqual(found, original); assert.deepEqual(page, { pins: [original], next_after: null });
        assert.ok(Object.isFrozen(found)); assert.ok(Object.isFrozen(found.binding.scope));
        assert.deepEqual(trace.values.map(row => row.bytes), [size, size]);
        assert.deepEqual(trace.probes.map(row => row.bytes), [size, size]);
        assert.ok(trace.transactions.every(Boolean));
      });
      assert.equal(readText(f, key), text);
    } finally { writeText(f, key, saved); }
  }));
}

test('Pin envelope budget: an excessive record beyond lookahead is not visited or certified', () => pinFixture(f => {
  for (const n of [101, 102, 103]) addPin(f, n);
  const key = metadataKey(id(103)), saved = readText(f, key);
  writeText(f, key, padded(saved, LIMIT + 1)); const before = snapshot(f);
  try {
    observe(trace => {
      assert.deepEqual(f.coordinator.listSourcePins({ limit: 1 }).pins.map(p => p.reservation_id), [id(101)]);
      assert.deepEqual(trace.probes.map(p => p.key), [metadataKey(id(101)), metadataKey(id(102))]);
      assert.deepEqual(trace.values.map(p => p.key), [metadataKey(id(101)), metadataKey(id(102))]);
    });
    observe(trace => {
      reject(() => f.coordinator.listSourcePins({ limit: 1, after: id(101) }));
      notMaterialized(trace, key); assert.deepEqual(trace.values.map(p => p.key), [metadataKey(id(102))]);
    });
    assert.deepEqual(snapshot(f), before);
  } finally { writeText(f, key, saved); }
}));

test('Pin envelope budget: scalar check and value retrieval share the same real SQLite snapshot', () => pinFixture(f => {
  const original = f.coordinator.pinSource(f.b, f.request), key = metadataKey(id(101)), saved = readText(f, key);
  const oversized = padded(saved, LIMIT + 1); let changed = 0;
  try {
    observe(trace => {
      assert.deepEqual(f.coordinator.readSourcePin(f.b, id(101)), original);
      assert.equal(changed, 1); assert.deepEqual(trace.values.map(row => row.bytes), [Buffer.byteLength(saved)]);
      assert.ok(trace.transactions.every(Boolean));
    }, observedKey => {
      if (observedKey === key && changed === 0) {
        // Deliberately bypass workspace cooperation in the fixture to witness WAL isolation.
        const writer = new DatabaseSync(f.path);
        try {
          writer.exec('BEGIN IMMEDIATE');
          writer.prepare('UPDATE meta SET value=? WHERE key=?').run(oversized, key);
          writer.exec('COMMIT'); changed++;
        } finally { writer.close(); }
      }
    });
    assert.equal(readText(f, key), oversized);
    observe(trace => { reject(() => f.coordinator.readSourcePin(f.b, id(101))); notMaterialized(trace, key); });
  } finally { writeText(f, key, saved); }
}));

test('Pin envelope budget: scalar read failure is sanitized and leaves the connection reusable', () => pinFixture(f => {
  const original = f.coordinator.pinSource(f.b, f.request), before = snapshot(f); let injections = 0;
  observe(trace => {
    let returned;
    assert.throws(() => { returned = f.coordinator.listSourcePins({ limit: 1 }); },
      e => e.code === 'E_STORAGE' && e.reason === 'operation failed' && e.message === 'storage: operation failed');
    assert.equal(returned, undefined); assert.equal(injections, 1); assert.equal(trace.values.length, 0);
  }, () => { injections++; throw Error('private synthetic preflight detail'); });
  assert.deepEqual(snapshot(f), before);
  assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired');
  assert.deepEqual(f.coordinator.readSourcePin(f.b, id(101)), original);
}));

for (const encoding of ['UTF-16le', 'UTF-16be']) {
  test(`Pin envelope budget: ${encoding} cannot understate UTF-8 bytes`, () => {
    // Real alternate-encoding database; the normative DDL, not a simulated storage algorithm.
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`PRAGMA encoding='${encoding}'`);
      db.exec(readFileSync(new URL('../../packages/storage/src/schema-v1.sql', import.meta.url), 'utf8'));
      const key = metadataKey(id(101)), value = '"' + '界'.repeat(5500) + '"';
      db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(key, value);
      assert.equal(db.prepare('PRAGMA encoding').get().encoding, encoding);
      assert.ok(db.prepare('SELECT octet_length(value) AS n FROM meta WHERE key=?').get(key).n < LIMIT);
      assert.ok(Buffer.byteLength(value) > LIMIT);
      db.exec('BEGIN');
      observe(trace => { reject(() => loadSourcePin(db, binding(), id(101))); notMaterialized(trace, key); });
      assert.equal(db.isTransaction, true, 'the internal loader must not end its caller transaction');
      db.exec('ROLLBACK');
    } finally { db.close(); }
  });
}

test('Pin envelope budget: released history is bounded by ID but is not swept by discovery', () => pinFixture(f => {
  f.coordinator.pinSource(f.b, f.request); f.coordinator.releaseSourcePin(f.b, id(101));
  const key = metadataKey(id(101)), saved = readText(f, key);
  writeText(f, key, padded(saved, LIMIT + 1)); const before = snapshot(f);
  try {
    observe(trace => { reject(() => f.coordinator.readSourcePin(f.b, id(101))); notMaterialized(trace, key); });
    observe(trace => {
      assert.deepEqual(f.coordinator.listSourcePins({ limit: 1 }), { pins: [], next_after: null });
      assert.equal(trace.values.length, 0); assert.equal(trace.probes.length, 0);
    });
    assert.deepEqual(snapshot(f), before);
  } finally { writeText(f, key, saved); }
}));
