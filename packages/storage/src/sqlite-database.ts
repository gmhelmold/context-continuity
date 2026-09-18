/** Node-only SQLite binding. The caller supplies an existing private workspace directory.
 * Not a path resolver, blob store, OS workspace lock or hostile-same-user sandbox. */
import { DatabaseSync } from 'node:sqlite';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { entityId, hashPayload, hashSource } from '../../core/src/identity.ts';
import { closedRecord } from '../../core/src/validation.ts';
import { StorageError, storageFailure } from './errors.ts';
export type WorkspaceIdentity = Readonly<{ installation_id: string; workspace_id: string }>;
export type SQLiteHandle = Readonly<{ db: DatabaseSync; identity: WorkspaceIdentity; guard: () => void }>;
export const APPLICATION_ID = 0x43434c44;
export const SCHEMA_VERSION = 1;
const DDL = readFileSync(new URL('./schema-v1.sql', import.meta.url), 'utf8');
const DDL_DIGEST = hashSource(Buffer.from(DDL));
const OPEN_OPTIONS = { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false };
function shape(db: DatabaseSync): string {
  return hashPayload(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all());
}
const EXPECTED_SHAPE = (() => {
  const db = new DatabaseSync(':memory:', OPEN_OPTIONS);
  try { db.exec(DDL); return shape(db); } finally { db.close(); }
})();
export function workspaceIdentity(input: unknown): WorkspaceIdentity {
  const v = closedRecord(input, ['installation_id', 'workspace_id'], ['installation_id', 'workspace_id'], 'workspace');
  return Object.freeze({ installation_id: entityId(v.installation_id), workspace_id: entityId(v.workspace_id) });
}
function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function privateFile(path: string, required: boolean): ReturnType<typeof lstatSync> | null {
  let stat;
  try { stat = lstatSync(path); } catch (error) { if (!required && absent(error)) return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600) {
    throw new StorageError('E_STORAGE', 'database file must be private and regular');
  }
  return stat;
}
function directoryInfo(input: unknown) {
  if (process.platform !== 'linux' && process.platform !== 'darwin') throw new StorageError('E_CAPABILITY', 'local POSIX profile required');
  if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\0')) throw new StorageError('E_STORAGE', 'absolute workspace directory required');
  const stat = lstatSync(input);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) {
    throw new StorageError('E_STORAGE', 'workspace directory must be private and owned');
  }
  return { directory: realpathSync(input), stat };
}
function syncDirectory(directory: string): void {
  const fd = openSync(directory, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function scalar(db: DatabaseSync, pragma: string): unknown {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  return row ? Object.values(row)[0] : undefined;
}
function configure(db: DatabaseSync): void {
  db.exec('PRAGMA busy_timeout=250; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON;');
  if (scalar(db, 'journal_mode=WAL') !== 'wal' || scalar(db, 'foreign_keys') !== 1 || scalar(db, 'synchronous') !== 2 || scalar(db, 'busy_timeout') !== 250) {
    throw new StorageError('E_CAPABILITY', 'required SQLite settings unavailable');
  }
}
function inspect(db: DatabaseSync, identity: WorkspaceIdentity): void {
  if (scalar(db, 'user_version') !== SCHEMA_VERSION || scalar(db, 'application_id') !== APPLICATION_ID) {
    throw new StorageError('E_CAPABILITY', 'unsupported or incomplete database schema');
  }
  if (shape(db) !== EXPECTED_SHAPE) throw new StorageError('E_STORAGE', 'schema structure mismatch');
  for (const [key, value] of Object.entries({ ...identity, schema_digest: DDL_DIGEST })) {
    if (db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value !== value) {
      throw new StorageError(key === 'schema_digest' ? 'E_STORAGE' : 'E_SCOPE', 'workspace metadata mismatch');
    }
  }
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
    throw new StorageError('E_STORAGE', 'database integrity check failed');
  }
}
/** create is exclusive; open never initializes an absent/foreign/incomplete database. */
export function connectSQLite(directoryInput: unknown, identityInput: unknown, create: boolean): SQLiteHandle {
  const identity = workspaceIdentity(identityInput);
  let db: DatabaseSync | undefined;
  try {
    const { directory, stat: parent } = directoryInfo(directoryInput);
    const path = join(directory, 'ledger.sqlite');
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = privateFile(path + suffix, false);
      if (create && sidecar !== null) throw new StorageError('E_CONFLICT', 'database sidecar already exists');
    }
    if (create) {
      // Never truncate an existing file, even when it appears empty.
      let fd: number;
      try { fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageError('E_CONFLICT', 'database already exists'); throw error; }
      try { fsyncSync(fd); } finally { closeSync(fd); }
      syncDirectory(directory);
    }
    const original = privateFile(path, true)!;
    const guard = (): void => {
      const current = directoryInfo(directory);
      if (current.stat.dev !== parent.dev || current.stat.ino !== parent.ino) throw new StorageError('E_STORAGE', 'workspace replaced');
      const file = privateFile(path, true)!;
      if (file.dev !== original.dev || file.ino !== original.ino) throw new StorageError('E_STORAGE', 'database replaced');
      for (const suffix of ['-wal', '-shm', '-journal']) privateFile(path + suffix, false);
    };
    if (!create) {
      // Inspection precedes write connection/journal negotiation. No automatic migration.
      const reader = new DatabaseSync(path, { ...OPEN_OPTIONS, readOnly: true });
      try { reader.exec('PRAGMA busy_timeout=250; PRAGMA trusted_schema=OFF;'); inspect(reader, identity); }
      finally { reader.close(); }
    }
    db = new DatabaseSync(path, OPEN_OPTIONS);
    configure(db); guard();
    if (create) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(DDL);
        for (const [key, value] of Object.entries({ ...identity, schema_digest: DDL_DIGEST, clock_high_water_ms: '0' })) {
          db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(key, value);
        }
        db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      // SQLite synchronizes pages/WAL; sync the directory entry as well.
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { if (fstatSync(fd).ino !== original.ino) throw new StorageError('E_STORAGE', 'database replaced'); fsyncSync(fd); }
      finally { closeSync(fd); }
      syncDirectory(directory);
    }
    inspect(db, identity); guard();
    return Object.freeze({ db, identity, guard });
  } catch (error) {
    try { db?.close(); } catch { /* Original failure is preserved without private details. */ }
    // A failed exclusive bootstrap may leave an incomplete file, never a half-valid schema.
    // Do not delete unknown files or reinterpret them on open; explicit diagnosis is required.
    return storageFailure(error);
  }
}
