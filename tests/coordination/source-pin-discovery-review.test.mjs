/** SPEC-22 integration review. Real SQLite and kernel locks; synthetic fixtures.
 * Build and execute through GitHub Actions only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { pinFixture, workspace, id, sql, metadataKey } from './source-pin-fixtures.mjs';
import { pythonTry } from './coordinator-fixtures.mjs';

const ownerPath = (f, owner) => join(f.directory, 'owners', `${owner}.lock`);
const ids = page => page.pins.map(pin => pin.reservation_id);
const pin = (f, n, owner = f.coordinator) => owner.pinSource(f.b, {
  ...f.request, reservation_id: id(n), operation_id: id(n + 1000),
});
const snapshot = f => Object.fromEntries([
  'storage_reservations', 'storage_owners', 'meta', 'sources', 'sessions', 'jobs', 'attempts', 'aux_runs',
].map(table => [table, sql(f, `SELECT * FROM ${table} ORDER BY rowid`)]));

test('Pin discovery review: corruption beyond the selected window is neither scanned nor certified', () => pinFixture(f => {
  for (const n of [201, 202, 203]) pin(f, n);
  const key = metadataKey(id(203));
  const original = sql(f, 'SELECT value FROM meta WHERE key=?', key)[0].value;
  sql(f, 'UPDATE meta SET value=? WHERE key=?', JSON.stringify({ ...JSON.parse(original), digest: '0'.repeat(64) }), key);
  const before = snapshot(f);
  try {
    // limit=1 selects 201 and the validated lookahead 202; 203 is not in this snapshot window.
    const first = f.coordinator.listSourcePins({ limit: 1 });
    assert.deepEqual(ids(first), [id(201)]);
    assert.equal(first.next_after, id(201));
    let next;
    assert.throws(() => { next = f.coordinator.listSourcePins({ limit: 1, after: first.next_after }); },
      e => e.code === 'E_STORAGE');
    assert.equal(next, undefined, 'invalid lookahead must not return a partial page');
    assert.deepEqual(snapshot(f), before, 'discovery must not repair or discard corrupt metadata');
    assert.deepEqual(f.coordinator.listSourcePins({ limit: 1 }), first,
      'a failed continuation must not consume a cursor or poison a healthy connection');
  } finally { sql(f, 'UPDATE meta SET value=? WHERE key=?', original, key); }
  const second = f.coordinator.listSourcePins({ limit: 1, after: id(201) });
  assert.deepEqual(ids(second), [id(202)]);
  assert.equal(second.next_after, id(202));
  assert.deepEqual(ids(f.coordinator.listSourcePins({ limit: 1, after: second.next_after })), [id(203)]);
}));

test('Pin discovery review: invalid lookahead owner refuses the page without touching a live reader', () => pinFixture(f => {
  pin(f, 201);
  const live = WorkspaceCoordinator.open(f.directory, workspace);
  let tail;
  try {
    tail = pin(f, 202, live);
    sql(f, "UPDATE storage_owners SET state='retired' WHERE owner_id=?", live.owner_id);
    const before = snapshot(f);
    let page;
    try {
      assert.throws(() => { page = f.coordinator.listSourcePins({ limit: 1 }); }, e => e.code === 'E_STORAGE');
      assert.equal(page, undefined, 'a valid first record cannot hide an inconsistent lookahead owner');
      assert.deepEqual(snapshot(f), before);
      assert.equal(pythonTry(ownerPath(f, live.owner_id)), 'busy', 'diagnostic read must not release the original owner lock');
      assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired');
    } finally { sql(f, "UPDATE storage_owners SET state='active' WHERE owner_id=?", live.owner_id); }
    assert.deepEqual(ids(f.coordinator.listSourcePins({ limit: 1 })), [id(201)]);
    assert.deepEqual(Buffer.from(live.readPinnedSource(f.b, tail.reservation_id).bytes), Buffer.from(f.source.bytes));
    assert.equal(f.coordinator.recoverSourcePin(f.b, tail.reservation_id).state, 'held');
  } finally {
    try { if (tail) live.releaseSourcePin(f.b, tail.reservation_id); }
    finally { live.close(); }
  }
}));

test('Pin discovery review: failed read rollback poisons only the reader and preserves live participants', () => pinFixture(f => {
  const original = pin(f, 201);
  const reader = WorkspaceCoordinator.open(f.directory, workspace);
  const before = snapshot(f);
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  let target, metadataFailures = 0, rollbackFailures = 0, returned;
  try {
    DatabaseSync.prototype.prepare = function(query) {
      if (query.startsWith('SELECT reservation_id FROM storage_reservations')) target = this;
      const statement = prepare.call(this, query);
      if (this === target && query === 'SELECT value FROM meta WHERE key=?') {
        const get = statement.get;
        statement.get = function(...args) {
          if (args[0] === metadataKey(original.reservation_id)) {
            metadataFailures++;
            throw Error('synthetic discovery metadata read failure');
          }
          return get.apply(this, args);
        };
      }
      return statement;
    };
    DatabaseSync.prototype.exec = function(query) {
      if (this === target && query === 'ROLLBACK') {
        rollbackFailures++;
        throw Error('synthetic discovery rollback failure');
      }
      return exec.call(this, query);
    };
    try {
      assert.throws(() => { returned = reader.listSourcePins({ limit: 1 }); },
        e => e.code === 'E_STORAGE' && e.message === 'coordinator rollback failed');
    } finally {
      DatabaseSync.prototype.prepare = prepare;
      DatabaseSync.prototype.exec = exec;
    }
    assert.equal(metadataFailures, 1);
    assert.equal(rollbackFailures, 1);
    assert.equal(returned, undefined);
    assert.deepEqual(snapshot(f), before, 'failed discovery must not publish any metadata change');
    assert.equal(pythonTry(join(f.directory, 'workspace.lock')), 'acquired', 'workspace exclusion must be released after failure');
    assert.equal(pythonTry(ownerPath(f, original.owner_id)), 'busy', 'original reader is still live');
    assert.equal(pythonTry(ownerPath(f, reader.owner_id)), 'busy', 'poisoning a DB connection is not owner retirement');
    assert.throws(() => reader.listSourcePins({ limit: 1 }), e => e.code === 'E_STORAGE');
    const fresh = WorkspaceCoordinator.open(f.directory, workspace);
    try {
      assert.deepEqual(fresh.listSourcePins({ limit: 1 }), { pins: [original], next_after: null });
      assert.equal(fresh.recoverSourcePin(original.binding, original.reservation_id).state, 'held');
      assert.deepEqual(Buffer.from(f.coordinator.readPinnedSource(f.b, original.reservation_id).bytes), Buffer.from(f.source.bytes));
    } finally { fresh.close(); }
  } finally {
    DatabaseSync.prototype.prepare = prepare;
    DatabaseSync.prototype.exec = exec;
    // The unusable DB cannot retire its participant; close must still revoke and release resources.
    try { reader.close(); } catch (e) { if (e.code !== 'E_STORAGE') throw e; }
  }
  assert.equal(pythonTry(ownerPath(f, reader.owner_id)), 'acquired');
  assert.equal(pythonTry(ownerPath(f, original.owner_id)), 'busy');
}));
