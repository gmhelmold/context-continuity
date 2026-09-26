/** Bootstrap encoding regressions using NEW private synthetic SQLite databases.
 * Run only in Actions with the existing native build and pinned Node runtimes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, openSync, closeSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hashSource} from '../../packages/core/src/identity.ts';
import {connectSQLite, APPLICATION_ID} from '../../packages/storage/src/sqlite-database.ts';
import {WorkspaceCoordinator} from '../../packages/storage/src/workspace-coordinator.ts';
import {workspace, sql} from './coordinator-fixtures.mjs';

const anchorKey = 'coordinator.anchor.v1';
const ddl = readFileSync(new URL('../../packages/storage/src/schema-v1.sql', import.meta.url), 'utf8');
const encodings = ['UTF-8', 'UTF-16le', 'UTF-16be'];

function encodedLedger(encoding, action) {
  assert.ok(encodings.includes(encoding), 'encoding must be a fixed fixture value');
  const directory = mkdtempSync(join(tmpdir(), 'cc-bootstrap-encoding-'));
  const f = {directory, path: join(directory, 'ledger.sqlite')};
  try {
    // SQLite ignores attempts to change an existing database encoding. Set it
    // before executing the SAME schema asset used by the production foundation.
    closeSync(openSync(f.path, 'wx', 0o600));
    const db = new DatabaseSync(f.path);
    try {
      db.exec(`PRAGMA encoding='${encoding}';`);
      db.exec(ddl);
      for (const [key, value] of Object.entries({
        ...workspace,
        schema_digest: hashSource(Buffer.from(ddl)),
        clock_high_water_ms: '0',
      })) db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(key, value);
      db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;`);
      assert.equal(db.prepare('PRAGMA encoding').get().encoding, encoding, 'fixture encoding must be real');
    } finally { db.close(); }

    // Prove the fixture is accepted by the actual schema/workspace inspector.
    // A fixture construction failure must not count as coordinator rejection.
    const handle = connectSQLite(directory, workspace, false);
    try {
      assert.equal(handle.db.prepare('PRAGMA encoding').get().encoding, encoding);
      handle.guard();
    } finally { handle.db.close(); }
    return action(f);
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

const snapshot = f => ({
  meta: sql(f, 'SELECT key,CAST(value AS BLOB) AS bytes FROM meta ORDER BY key'),
  owners: sql(f, 'SELECT * FROM storage_owners ORDER BY owner_id'),
  reservations: sql(f, 'SELECT * FROM storage_reservations ORDER BY reservation_id'),
});

for (const encoding of ['UTF-16le', 'UTF-16be']) {
  test(`Bootstrap encoding: ${encoding} refuses before coordinator initialization`, () => encodedLedger(encoding, f => {
    const before = snapshot(f);
    assert.equal(sql(f, 'SELECT 1 FROM meta WHERE key=?', anchorKey).length, 0);
    assert.equal(existsSync(join(f.directory, 'workspace.lock')), false);
    assert.equal(existsSync(join(f.directory, 'owners')), false);

    assert.throws(() => WorkspaceCoordinator.initialize(f.directory, workspace), error =>
      error?.code === 'E_CAPABILITY' &&
      error.message === 'storage: coordinator identity unavailable or inconsistent',
    'IDENTITY_BOOTSTRAP_ENCODING');

    assert.deepEqual(snapshot(f), before, 'unsupported encoding must not publish coordinator records');
    assert.equal(existsSync(join(f.directory, 'workspace.lock')), false,
      'encoding preflight must precede creation of the workspace lock');
    assert.equal(existsSync(join(f.directory, 'owners')), false,
      'encoding preflight must precede creation of the owners directory');
    assert.equal(sql(f, 'PRAGMA encoding')[0].encoding, encoding, 'no implicit encoding migration');
  }));
}

 test('Bootstrap encoding: UTF-8 initializes and opens normally', () => encodedLedger('UTF-8', f => {
  WorkspaceCoordinator.initialize(f.directory, workspace);
  assert.equal(sql(f, 'SELECT 1 FROM meta WHERE key=?', anchorKey).length, 1);
  const coordinator = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    assert.equal(coordinator.readOwner(coordinator.owner_id).state, 'active');
    assert.equal(coordinator.withWorkspaceLock(() => 'held'), 'held');
  } finally { coordinator.close(); }
  assert.equal(sql(f, 'SELECT state FROM storage_owners WHERE owner_id=?', coordinator.owner_id)[0].state, 'retired');
  assert.equal(sql(f, 'PRAGMA encoding')[0].encoding, 'UTF-8');
}));
