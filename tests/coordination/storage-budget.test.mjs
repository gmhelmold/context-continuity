/** SPEC-23 behavior and real integration. Execute only through Actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WorkspaceCoordinator, WORKSPACE_CONTENT_QUOTA_BYTES as QUOTA } from '../../packages/storage/src/index.ts';
import { readWorkspaceBudget, assertStorageCapacity } from '../../packages/storage/src/storage-budget.ts';
import { LockResources } from '../../packages/storage/src/lock-resources.ts';
import { pythonTry } from './coordinator-fixtures.mjs';
import { fixture, budgetFixture, binding, config, source, retain, reserve, blob, snapshot, writer, sql, id } from './storage-budget-fixtures.mjs';
const reject = (fn, marker = 'BUDGET_INVALID') => assert.throws(fn, e => e.code === 'E_STORAGE', marker);
const empty = { quota_bytes: QUOTA, inline_bytes: 0, blob_bytes: 0, reserved_bytes: 0,
  used_bytes: 0, remaining_bytes: QUOTA, over_quota: false };

test('Budget: empty workspace returns immutable scalar data without writes', () => fixture(f => {
  const c = f.open(), before = snapshot(f), report = c.readStorageBudget();
  assert.deepEqual(report, empty);
  assert.equal(Object.isFrozen(report), true);
  assert.throws(() => { report.remaining_bytes = 0; }, TypeError);
  assert.deepEqual(snapshot(f), before);
}));

test('Budget: inline bytes across sessions and revisions are charged without digest deduplication', () => budgetFixture(f => {
  const a = source(10, '\ufeffé𐀀\0\r\n'), zero = source(11, ''), next = source(10, 'revised', 1);
  retain(f, [a, zero, next]);
  const b = binding('budget-B'); f.s.createSession(b, config);
  retain(f, [source(12, a.bytes)], f.s.acquireLease(b));
  const expected = a.bytes.length * 2 + next.bytes.length;
  assert.equal(f.c.readStorageBudget().inline_bytes, expected, 'BUDGET_INLINE_WORKSPACE');
  assert.equal(f.c.readStorageBudget().used_bytes, expected);
}));

test('Budget: inline accounting uses stored bytes rather than source size metadata', () => budgetFixture(f => {
  const a = source(10, 'é𐀀'); retain(f, [a]);
  sql(f, 'UPDATE sources SET size_bytes=1');
  assert.equal(f.c.readStorageBudget().inline_bytes, a.bytes.length, 'BUDGET_ACTUAL_INLINE');
  assert.throws(() => f.s.readSource(f.b, a.ref), e => e.code === 'E_SOURCE');
}));

test('Budget: catalog blobs are charged once even with multiple source references', () => budgetFixture(f => {
  blob(f, 1, 53);
  const digest = '0'.repeat(63) + '1';
  for (const n of [10, 11]) sql(f, `INSERT INTO sources VALUES
    (?,?,0,?,'[]','captured','application/octet-stream',53,NULL,?,0,'2026-01-01T00:00:00.000Z')`,
    f.b.session_key, id(n), digest, 'sources/00/' + digest);
  const report = f.c.readStorageBudget();
  assert.equal(report.blob_bytes, 53, 'BUDGET_BLOBS_ONCE');
  assert.equal(report.used_bytes, 53);
  assert.equal(report.inline_bytes, 0);
}));

test('Budget: all reservation kinds remain charged after owner retirement', () => budgetFixture(f => {
  reserve(f, 101, 7, 'staging'); reserve(f, 102, 11, 'read_pin'); reserve(f, 103, 13, 'export_pin');
  sql(f, "UPDATE storage_owners SET state='retired' WHERE owner_id=?", id(60000));
  const before = snapshot(f), report = f.c.readStorageBudget();
  assert.equal(report.reserved_bytes, 31, 'BUDGET_RESERVATIONS');
  assert.equal(report.used_bytes, 31);
  assert.deepEqual(snapshot(f), before, 'a budget read must never reconcile reservations');
}));

test('Budget: removed content is not charged but catalog orphans remain charged', () => budgetFixture(f => {
  retain(f, [source(10, 'old bytes')]);
  sql(f, "UPDATE sources SET availability='deleted',inline_bytes=NULL");
  blob(f, 1, 17);
  assert.equal(f.c.readStorageBudget().inline_bytes, 0);
  assert.equal(f.c.readStorageBudget().blob_bytes, 17);
  assert.equal(f.c.readStorageBudget().used_bytes, 17);
}));

test('Budget: admission includes the last byte and rejects the next write atomically', () => budgetFixture(f => {
  blob(f, 1, QUOTA - 8); reserve(f, 101, 3);
  const a = source(10, '12345');
  assert.doesNotThrow(() => retain(f, [a]), 'BUDGET_INCLUSIVE');
  assert.equal(f.c.readStorageBudget().used_bytes, QUOTA);
  assert.equal(f.c.readStorageBudget().remaining_bytes, 0);
  assert.equal(f.c.readStorageBudget().over_quota, false);
  const before = snapshot(f);
  assert.throws(() => retain(f, [source(11)]), e => e.code === 'E_BUDGET', 'BUDGET_FULL');
  assert.deepEqual(snapshot(f), before);
  retain(f, [source(12, '')]);
  assert.equal(f.c.readStorageBudget().used_bytes, QUOTA);
}));

test('Budget: an over-quota report is diagnostic and cannot forgive existing charges', () => budgetFixture(f => {
  const a = source(10, 'kept'); retain(f, [a]); blob(f, 1, QUOTA);
  const report = f.c.readStorageBudget();
  assert.equal(report.used_bytes, QUOTA + 4);
  assert.equal(report.over_quota, true);
  assert.equal(report.remaining_bytes, 0);
  assert.throws(() => retain(f, [source(11, '')]), e => e.code === 'E_BUDGET');
  // Existing exact replay consumes no space and retains the historical behavior.
  retain(f, [a]);
  assert.deepEqual(f.c.readStorageBudget(), report);
}));

test('Budget: a stale diagnostic never authorizes later admission', () => budgetFixture(f => {
  const prior = f.c.readStorageBudget();
  assert.equal(prior.remaining_bytes, QUOTA);
  reserve(f, 101, QUOTA);
  const before = snapshot(f);
  assert.throws(() => retain(f, [source(10)]), e => e.code === 'E_BUDGET', 'BUDGET_ADMISSION_FRESH');
  assert.deepEqual(snapshot(f), before);
  assert.equal(prior.remaining_bytes, QUOTA, 'the old report is immutable, not refreshed authority');
  assert.equal(f.c.readStorageBudget().remaining_bytes, 0);
}));

test('Budget: a later source exceeding capacity rolls back earlier sources in the batch', () => budgetFixture(f => {
  reserve(f, 101, QUOTA - 1);
  const before = snapshot(f);
  assert.throws(() => retain(f, [source(10), source(11)]), e => e.code === 'E_BUDGET');
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.c.readStorageBudget().inline_bytes, 0);
}));

test('Budget: metadata accounting is not a content integrity attestation', () => budgetFixture(f => {
  const a = source(10, 'original'); retain(f, [a]);
  const before = f.c.readStorageBudget();
  sql(f, 'UPDATE sources SET inline_bytes=zeroblob(size_bytes)');
  assert.deepEqual(f.c.readStorageBudget(), before);
  assert.throws(() => f.s.readSource(f.b, a.ref), e => e.code === 'E_SOURCE');
}));

test('Budget: fractional catalog charge is refused rather than rounded or omitted', () => budgetFixture(f => {
  blob(f, 1, 1.5); const before = snapshot(f);
  reject(() => f.c.readStorageBudget(), 'BUDGET_INVALID_CHARGE');
  assert.deepEqual(snapshot(f), before);
}));

for (const kind of ['blobs', 'storage_reservations']) {
  for (const value of ['not-a-number', Buffer.from('4')]) {
    test(`Budget: ${kind} rejects stored ${typeof value === 'string' ? 'text' : 'BLOB'} charge`, () => budgetFixture(f => {
      if (kind === 'blobs') blob(f, 1, value); else reserve(f, 101, value);
      const before = snapshot(f); reject(() => f.c.readStorageBudget()); assert.deepEqual(snapshot(f), before);
    }));
  }
  test(`Budget: ${kind} rejects negative charges instead of offsetting valid usage`, () => budgetFixture(f => {
    if (kind === 'blobs') blob(f, 1, 7); else reserve(f, 101, 7);
    writer(f, db => { db.exec('PRAGMA ignore_check_constraints=ON'); db.prepare(`UPDATE ${kind} SET size_bytes=-1`).run(); });
    reject(() => f.c.readStorageBudget());
    // Restore only the deliberately invalid fixture row before normal cleanup.
    sql(f, `UPDATE ${kind} SET size_bytes=7`);
  }));
}

test('Budget: inline TEXT cannot be mistaken for a byte-counted BLOB', () => budgetFixture(f => {
  retain(f, [source(10)]);
  sql(f, 'UPDATE sources SET inline_bytes=?,size_bytes=2', 'é');
  reject(() => f.c.readStorageBudget());
}));

test('Budget: unsafe aggregate totals fail closed rather than losing precision', () => budgetFixture(f => {
  blob(f, 1, Number.MAX_SAFE_INTEGER); reserve(f, 101, 1);
  reject(() => f.c.readStorageBudget(), 'BUDGET_SAFE_TOTAL');
}));

test('Budget: SQLite integer overflow is sanitized rather than treated as free capacity', () => budgetFixture(f => {
  blob(f, 1, 9223372036854775807n); blob(f, 2, 1);
  assert.throws(() => f.c.readStorageBudget(), e => e.code === 'E_STORAGE' && !e.message.includes('overflow'));
}));

test('Budget: the internal reader refuses a missing transaction before queries', () => budgetFixture(f => {
  writer(f, db => reject(() => readWorkspaceBudget(db), 'BUDGET_TRANSACTION'));
}));

test('Budget: invalid additional amounts are rejected without coercion', () => budgetFixture(f => {
  writer(f, db => {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const value of [-1, 1.5, NaN, Infinity, '1', 1n, { valueOf() { throw Error('coercion forbidden'); } }]) {
        reject(() => assertStorageCapacity(db, value));
      }
      assertStorageCapacity(db, 0);
    } finally { db.exec('ROLLBACK'); }
  });
}));

test('Budget: aggregates transfer scalar rows only and hold the workspace lock', () => budgetFixture(f => {
  retain(f, [source(10, Buffer.alloc(4096, 17))]); blob(f, 1, 23); reserve(f, 101, 29);
  const before = snapshot(f), prepare = DatabaseSync.prototype.prepare, execute = DatabaseSync.prototype.exec;
  const rows = [], statements = []; let witnessed = false;
  try {
    DatabaseSync.prototype.exec = function(query) { statements.push(query); return execute.call(this, query); };
    DatabaseSync.prototype.prepare = function(query) {
      statements.push(query);
      const statement = prepare.call(this, query);
      if (query.includes(' AS bytes')) {
        const get = statement.get;
        statement.get = function(...args) {
          const row = get.apply(this, args); rows.push(row);
          if (!witnessed) { witnessed = true; assert.equal(pythonTry(f.lock), 'busy'); }
          return row;
        };
      }
      return statement;
    };
    assert.equal(f.c.readStorageBudget().used_bytes, 4096 + 23 + 29);
  } finally { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = execute; }
  assert.equal(rows.length, 3, 'BUDGET_SCALAR_READS');
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['bytes', 'invalid']);
    assert.ok(Object.values(row).every(value => typeof value === 'number'));
  }
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('COMMIT'));
  assert.ok(!statements.some(query => /^(INSERT|UPDATE|DELETE|BEGIN IMMEDIATE)/.test(query)));
  assert.deepEqual(snapshot(f), before);
  assert.equal(pythonTry(f.lock), 'acquired');
}));

test('Budget: interleaved WAL writes cannot mix accounting snapshots', () => budgetFixture(f => {
  retain(f, [source(10, 'abc')]); blob(f, 1, 40); reserve(f, 101, 60);
  const prepare = DatabaseSync.prototype.prepare; let changed = false, report;
  try {
    DatabaseSync.prototype.prepare = function(query) {
      const statement = prepare.call(this, query);
      if (query.includes(' AS bytes') && query.trimEnd().endsWith('FROM sources')) {
        const get = statement.get;
        statement.get = function(...args) {
          const value = get.apply(this, args);
          if (!changed) {
            changed = true;
            writer(f, db => {
              db.exec('BEGIN IMMEDIATE');
              db.exec('UPDATE sources SET inline_bytes=zeroblob(9),size_bytes=9');
              db.exec('UPDATE blobs SET size_bytes=400');
              db.exec('UPDATE storage_reservations SET size_bytes=600');
              db.exec('COMMIT');
            });
          }
          return value;
        };
      }
      return statement;
    };
    report = f.c.readStorageBudget();
  } finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(changed, true);
  assert.deepEqual([report.inline_bytes, report.blob_bytes, report.reserved_bytes], [3, 40, 60], 'BUDGET_ONE_SNAPSHOT');
  assert.equal(f.c.readStorageBudget().used_bytes, 1009, 'a later transaction sees the new committed state');
}));

test('Budget: lock contention refuses before starting accounting queries', () => budgetFixture(f => {
  const lock = LockResources.open(f.directory, false); lock.acquire();
  const prepare = DatabaseSync.prototype.prepare; let calls = 0;
  try {
    DatabaseSync.prototype.prepare = function(query) { if (query.includes(' AS bytes')) calls++; return prepare.call(this, query); };
    assert.throws(() => f.c.readStorageBudget(), e => e.code === 'E_CONFLICT');
    assert.equal(calls, 0);
    assert.equal(pythonTry(f.lock), 'busy');
  } finally { DatabaseSync.prototype.prepare = prepare; lock.close(); }
  assert.equal(f.c.readStorageBudget().used_bytes, 0);
}));

test('Budget: a missing aggregate row is not an empty workspace', () => budgetFixture(f => {
  const prepare = DatabaseSync.prototype.prepare; let hit = 0;
  try {
    DatabaseSync.prototype.prepare = function(query) {
      const statement = prepare.call(this, query);
      if (query.includes(' AS bytes')) statement.get = () => { hit++; return undefined; };
      return statement;
    };
    reject(() => f.c.readStorageBudget());
  } finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(hit, 1);
  assert.equal(f.c.readStorageBudget().used_bytes, 0);
}));

test('Budget: a scalar SQL error is sanitized and a fresh read remains usable', () => budgetFixture(f => {
  const before = snapshot(f), prepare = DatabaseSync.prototype.prepare; let hit = 0;
  try {
    DatabaseSync.prototype.prepare = function(query) {
      if (query.includes(' AS bytes')) { hit++; throw Error('private synthetic accounting SQL'); }
      return prepare.call(this, query);
    };
    assert.throws(() => f.c.readStorageBudget(), e => e.code === 'E_STORAGE' && e.message === 'storage: operation failed');
  } finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(hit, 1);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.c.readStorageBudget().used_bytes, 0);
}));

test('Budget: failed read COMMIT returns no report and preserves storage', () => budgetFixture(f => {
  blob(f, 1, 19); const before = snapshot(f);
  const prepare = DatabaseSync.prototype.prepare, execute = DatabaseSync.prototype.exec;
  let target, failures = 0, returned;
  try {
    DatabaseSync.prototype.prepare = function(query) { if (query.includes(' AS bytes')) target = this; return prepare.call(this, query); };
    DatabaseSync.prototype.exec = function(query) {
      if (this === target && query === 'COMMIT') { failures++; throw Error('synthetic commit refusal'); }
      return execute.call(this, query);
    };
    reject(() => { returned = f.c.readStorageBudget(); });
  } finally { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = execute; }
  assert.equal(failures, 1); assert.equal(returned, undefined);
  assert.deepEqual(snapshot(f), before);
  assert.equal(pythonTry(f.lock), 'acquired');
  assert.equal(f.c.readStorageBudget().used_bytes, 19);
}));

test('Budget: failed rollback poisons the connection without releasing a live owner', () => budgetFixture(f => {
  const before = snapshot(f), prepare = DatabaseSync.prototype.prepare, execute = DatabaseSync.prototype.exec;
  let target, failures = 0, returned;
  try {
    DatabaseSync.prototype.prepare = function(query) {
      if (query.includes(' AS bytes')) { target = this; throw Error('synthetic aggregate refusal'); }
      return prepare.call(this, query);
    };
    DatabaseSync.prototype.exec = function(query) {
      if (this === target && query === 'ROLLBACK') { failures++; throw Error('synthetic rollback refusal'); }
      return execute.call(this, query);
    };
    assert.throws(() => { returned = f.c.readStorageBudget(); }, e => e.code === 'E_STORAGE' && e.reason === 'coordinator rollback failed');
  } finally { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = execute; }
  assert.equal(failures, 1); assert.equal(returned, undefined);
  assert.deepEqual(snapshot(f), before);
  assert.equal(pythonTry(f.lock), 'acquired');
  assert.equal(pythonTry(join(f.owners, f.c.owner_id + '.lock')), 'busy');
  reject(() => f.c.readStorageBudget());
  reject(() => f.c.close());
  assert.equal(pythonTry(join(f.owners, f.c.owner_id + '.lock')), 'acquired');
  assert.equal(f.open().readStorageBudget().used_bytes, 0);
}));

test('Budget: a closed coordinator cannot supply a new report', () => budgetFixture(f => {
  f.c.close();
  assert.throws(() => f.c.readStorageBudget(), e => e.code === 'E_OWNER');
}));

test('Budget: workspaces do not share capacity', () => budgetFixture(a => budgetFixture(b => {
  blob(a, 1, QUOTA); reserve(b, 101, 7);
  assert.equal(a.c.readStorageBudget().remaining_bytes, 0);
  assert.equal(b.c.readStorageBudget().remaining_bytes, QUOTA - 7);
  retain(b, [source(10)]);
  assert.equal(a.c.readStorageBudget().used_bytes, QUOTA);
})));
