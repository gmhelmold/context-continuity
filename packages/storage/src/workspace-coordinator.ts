/** SPEC-18: synchronous local storage coordination, not execution liveness.
 * SPEC-21 adds owner-only source pins; no job, provider request or session lease is mutated. */
import { Buffer } from 'node:buffer';
import { types } from 'node:util';
import { canonical, parseJSON } from '../../core/src/canonical.mjs';
import { entityId, newEntityId } from '../../core/src/identity.ts';
import { choice, closedRecord, integer } from '../../core/src/validation.ts';
import { LockResources, sameFile } from './lock-resources.ts';
import type { FileIdentity, OwnerFile } from './lock-resources.ts';
import { connectSQLite, workspaceIdentity } from './sqlite-database.ts';
import type { SQLiteHandle, WorkspaceIdentity } from './sqlite-database.ts';
import { StorageError, storageFailure } from './errors.ts';
import { pinBinding, parseSourcePinRequest, createSourcePin, loadSourcePin, releaseSourcePin, readPinnedInlineSource,
  parseSourcePinPageRequest, listSourcePins as listActiveSourcePins } from './source-pins.ts';
import type { SourcePin, SourcePinPage } from './source-pins.ts';
import type { RetainedSource } from './source-records.ts';

const ANCHOR_KEY = 'coordinator.anchor.v1';
const constructionKey = Symbol('WorkspaceCoordinator construction');
const poisoned = new WeakSet<SQLiteHandle>();
const ownerKey = (id: string): string => `coordinator.owner.v1:${id}`;
export type StorageOwner = Readonly<{
  owner_id: string; process_instance: string; liveness_lock_key: string;
  state: 'active' | 'retired'; created_at: string; identity: FileIdentity;
}>;
declare const holdBrand: unique symbol;
export type WorkspaceHold = Readonly<{ workspace: WorkspaceIdentity; owner_id: string; process_instance: string; [holdBrand]: true }>;
export type OwnerInspection = Readonly<{ state: 'absent' | 'held' | 'retired'; owner: StorageOwner | null }>;
export type SourcePinRecovery = Readonly<{ state: 'held' | 'released'; pin: SourcePin }>;
const holds = new WeakMap<object, () => void>();
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
function capability(): never { throw new StorageError('E_CAPABILITY', 'coordinator identity unavailable or inconsistent'); }
/** SQL projects at most 8 KiB; one statement also works outside a read transaction.
 * Existence-only probes must not materialize an unvalidated identity envelope. */
function identityMetadata(handle: SQLiteHandle, key: string): { value: string } | undefined {
  if (handle.db.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') return capability();
  const r = handle.db.prepare(`SELECT typeof(value) AS storage_type, octet_length(value) AS size_bytes,
    CASE WHEN typeof(value)='text' AND octet_length(value) <= 8192 THEN value END AS value
    FROM meta WHERE key=?`).get(key);
  if (!r) return undefined;
  if (r.storage_type !== 'text' || typeof r.size_bytes !== 'number' || !Number.isSafeInteger(r.size_bytes) ||
      r.size_bytes < 0 || r.size_bytes > 8192 || typeof r.value !== 'string' ||
      Buffer.byteLength(r.value) !== r.size_bytes) return capability();
  return { value: r.value };
}
function data(text: unknown): unknown {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8192) return capability();
  try { return parseJSON(text); } catch { return capability(); }
}
function fileIdentity(input: unknown): FileIdentity {
  const r = closedRecord(input, ['dev', 'ino'], ['dev', 'ino'], 'file_identity');
  for (const v of [r.dev, r.ino]) if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(v)) return capability();
  return Object.freeze({ dev: r.dev as string, ino: r.ino as string });
}
function anchor(resources: LockResources, workspace: WorkspaceIdentity): unknown {
  return { schema_version: 1, workspace, resources: resources.identity };
}
function checkAnchor(handle: SQLiteHandle, resources: LockResources): void {
  if (poisoned.has(handle)) throw new StorageError('E_STORAGE', 'coordinator connection unusable');
  handle.guard(); resources.guard();
  const r = identityMetadata(handle, ANCHOR_KEY);
  if (!r || !equal(data(r.value), anchor(resources, handle.identity))) return capability();
}
function readOwner(handle: SQLiteHandle, id: string): StorageOwner | null {
  const r = handle.db.prepare('SELECT * FROM storage_owners WHERE owner_id=?').get(id);
  const metadata = identityMetadata(handle, ownerKey(id));
  if (!r) { if (metadata) return capability(); return null; }
  if (!metadata) return capability();
  try {
    const fields = ['schema_version', 'owner_id', 'process_instance', 'created_at', 'identity'];
    const m = closedRecord(data(metadata.value), fields, fields, 'owner_identity');
    integer(m.schema_version, 1, 1, 'owner_identity.version');
    const owner = entityId(r.owner_id), instance = entityId(r.process_instance);
    const created = r.created_at;
    if (owner !== id || r.liveness_lock_key !== `owners/${id}.lock` || m.owner_id !== id ||
        m.process_instance !== instance || m.created_at !== created || typeof created !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(created) ||
        !Number.isFinite(Date.parse(created)) || new Date(created).toISOString() !== created) return capability();
    return Object.freeze({ owner_id: id, process_instance: instance, liveness_lock_key: r.liveness_lock_key as string,
      state: choice(r.state, ['active', 'retired'] as const, 'owner.state'), created_at: created, identity: fileIdentity(m.identity) });
  } catch { return capability(); }
}
function noReservations(handle: SQLiteHandle, id: string): void {
  if (handle.db.prepare('SELECT 1 FROM storage_reservations WHERE owner_id=? LIMIT 1').get(id)) {
    throw new StorageError('E_CAPABILITY', 'owner reservations require explicit reconciliation');
  }
}
function transaction<T>(handle: SQLiteHandle, write: boolean, action: () => T, guard: () => void): T {
  let begun = false;
  try {
    guard(); handle.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN'); begun = true;
    const value = action(); guard(); handle.db.exec('COMMIT'); begun = false; return value;
  } catch (cause) {
    if (begun) {
      try { handle.db.exec('ROLLBACK'); }
      catch {
        poisoned.add(handle);
        try { handle.db.close(); } catch { /* Remains unusable even when driver close fails. */ }
        throw new StorageError('E_STORAGE', 'coordinator rollback failed');
      }
    }
    return storageFailure(cause);
  }
}
/** Always attempt both cleanups, and never return a raw driver/OS exception. */
function dispose(handle?: SQLiteHandle, resources?: LockResources): void {
  let failure: unknown;
  try { resources?.close(); } catch (cause) { failure = cause; }
  try { handle?.db.close(); } catch (cause) { failure ??= cause; }
  if (failure !== undefined) storageFailure(failure);
}
/** Expired/copied/other-workspace holds are never accepted as authority. */
export function assertWorkspaceHold(workspaceInput: unknown, input: unknown): WorkspaceHold {
  const workspace = workspaceIdentity(workspaceInput);
  if (input === null || typeof input !== 'object' || !holds.has(input)) throw new StorageError('E_OWNER', 'workspace hold expired or unissued');
  const hold = input as WorkspaceHold;
  if (!equal(hold.workspace, workspace)) throw new StorageError('E_SCOPE', 'workspace hold scope mismatch');
  // A caller may catch this failure before the enclosing section can sanitize it.
  try { holds.get(input)!(); } catch (cause) { return storageFailure(cause); }
  return hold;
}
function synchronous(callback: unknown): asserts callback is (hold: WorkspaceHold) => unknown {
  if (typeof callback !== 'function' || Object.getPrototypeOf(callback) !== Function.prototype || types.isAsyncFunction(callback) || types.isGeneratorFunction(callback)) {
    throw new StorageError('E_CAPABILITY', 'synchronous storage callback required');
  }
}
function synchronousResult(value: unknown): void {
  if (types.isPromise(value)) {
    // Observe a rejected native Promise without accepting it or awaiting work.
    Promise.prototype.then.call(value, undefined, () => {});
    throw new StorageError('E_CAPABILITY', 'asynchronous storage callback result');
  }
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && 'then' in value) {
    throw new StorageError('E_CAPABILITY', 'thenable storage callback result');
  }
}
export class WorkspaceCoordinator {
  readonly workspace: WorkspaceIdentity;
  readonly owner_id: string;
  readonly process_instance: string;
  #resources: LockResources;
  #handle: SQLiteHandle;
  #owner: OwnerFile;
  #closed = false;
  #busy = false;
  private constructor(resources: LockResources, handle: SQLiteHandle, owner: OwnerFile, record: StorageOwner, key: symbol) {
    if (key !== constructionKey) throw new StorageError('E_OWNER', 'coordinator must be opened through its factory');
    this.#resources = resources; this.#handle = handle; this.#owner = owner;
    this.workspace = handle.identity; this.owner_id = record.owner_id; this.process_instance = record.process_instance;
    Object.freeze(this);
  }
  /** Explicit bootstrap of lock identity, never database creation or owner creation.
   * Preflight inspects an existing DB; only the anchored write is under flock. */
  static initialize(directory: unknown, workspaceInput: unknown): void {
    const workspace = workspaceIdentity(workspaceInput);
    let handle: SQLiteHandle | undefined, resources: LockResources | undefined;
    try {
      handle = connectSQLite(directory, workspace, false);
      // Refuse unsupported encoding before creating any coordinator resources.
      if (handle.db.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') return capability();
      const existing = handle.db.prepare('SELECT 1 FROM meta WHERE key=?').get(ANCHOR_KEY);
      resources = LockResources.open(directory, !existing);
      resources.acquire();
      const h = handle, r = resources;
      transaction(h, true, () => {
        const current = h.db.prepare('SELECT 1 FROM meta WHERE key=?').get(ANCHOR_KEY);
        if (current) checkAnchor(h, r);
        else {
          if (h.db.prepare('SELECT 1 FROM storage_owners LIMIT 1').get() ||
              h.db.prepare("SELECT 1 FROM meta WHERE key LIKE 'coordinator.owner.v1:%' LIMIT 1").get()) return capability();
          h.db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(ANCHOR_KEY, canonical(anchor(r, workspace)));
        }
      }, () => { h.guard(); r.guard(); });
    } catch (cause) { storageFailure(cause); }
    finally {
      dispose(handle, resources);
    }
  }
  /** Owns exactly one fresh storage participant; no job supervisor is implied. */
  static open(directory: unknown, workspaceInput: unknown): WorkspaceCoordinator {
    const workspace = workspaceIdentity(workspaceInput);
    let resources: LockResources | undefined, handle: SQLiteHandle | undefined, owner: OwnerFile | undefined;
    try {
      resources = LockResources.open(directory, false); resources.acquire();
      handle = connectSQLite(resources.directory, workspace, false);
      checkAnchor(handle, resources);
      const id = newEntityId(), instance = newEntityId(), created = new Date().toISOString();
      owner = resources.owner(id, true);
      if (!owner.tryLock()) throw new StorageError('E_CONFLICT', 'new owner lock busy');
      const h = handle, r = resources, o = owner;
      const record = transaction(h, true, () => {
        h.db.prepare(`INSERT INTO storage_owners(owner_id,process_instance,liveness_lock_key,state,created_at)
          VALUES (?,?,?,'active',?)`).run(id, instance, `owners/${id}.lock`, created);
        h.db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(ownerKey(id), canonical({
          schema_version: 1, owner_id: id, process_instance: instance, created_at: created, identity: o.identity }));
        return readOwner(h, id)!;
      }, () => { checkAnchor(h, r); o.guard(); });
      resources.release();
      return new WorkspaceCoordinator(resources, handle, owner, record, constructionKey);
    } catch (cause) {
      dispose(handle, resources);
      return storageFailure(cause);
    }
  }
  #guard(): void {
    checkAnchor(this.#handle, this.#resources); this.#owner.guard();
    const row = readOwner(this.#handle, this.owner_id);
    if (!row || row.state !== 'active' || row.process_instance !== this.process_instance || !sameFile(row.identity, this.#owner.identity)) {
      throw new StorageError('E_OWNER', 'storage owner is no longer active');
    }
  }
  #locked<T>(action: () => T): T {
    if (this.#closed) throw new StorageError('E_OWNER', 'coordinator closed');
    if (this.#busy) throw new StorageError('E_CONFLICT', 'coordinator section is not reentrant');
    this.#busy = true;
    let acquired = false;
    try {
      this.#resources.acquire(); acquired = true; this.#guard();
      const value = action(); this.#guard(); return value;
    } catch (cause) { return storageFailure(cause); }
    finally {
      try { if (acquired) this.#resources.release(); } finally { this.#busy = false; }
    }
  }
  withWorkspaceLock<T>(callback: (hold: WorkspaceHold) => T): T {
    synchronous(callback);
    return this.#locked(() => {
      const hold = Object.freeze({ workspace: this.workspace, owner_id: this.owner_id, process_instance: this.process_instance }) as WorkspaceHold;
      holds.set(hold, () => { if (!this.#busy || this.#closed) throw new StorageError('E_OWNER', 'workspace hold expired'); this.#guard(); });
      try { const value = callback(hold) as T; synchronousResult(value); return value; }
      finally { holds.delete(hold); }
    });
  }
  readOwner(idInput: unknown): StorageOwner | null {
    const id = entityId(idInput);
    return this.#locked(() => transaction(this.#handle, false, () => readOwner(this.#handle, id), () => this.#guard()));
  }
  /** SPEC-21: explicit metadata reservation. This does not read or authenticate source bytes. */
  pinSource(bindingInput: unknown, requestInput: unknown): SourcePin {
    const binding = pinBinding(bindingInput, this.workspace), request = parseSourcePinRequest(requestInput);
    return this.#locked(() => transaction(this.#handle, true,
      () => createSourcePin(this.#handle.db, binding, request, { owner_id: this.owner_id, process_instance: this.process_instance }),
      () => this.#guard()));
  }
  /** Bounded active metadata candidates across this workspace, never cleanup authority. */
  listSourcePins(input: unknown): SourcePinPage {
    const request = parseSourcePinPageRequest(input);
    return this.#locked(() => transaction(this.#handle, false,
      () => listActiveSourcePins(this.#handle.db, this.workspace, request), () => this.#guard()));
  }
  readSourcePin(bindingInput: unknown, idInput: unknown): SourcePin | null {
    const binding = pinBinding(bindingInput, this.workspace), id = entityId(idInput);
    return this.#locked(() => transaction(this.#handle, false,
      () => loadSourcePin(this.#handle.db, binding, id), () => this.#guard()));
  }
  /** Read one verified inline copy. The pin remains active until explicitly released. */
  readPinnedSource(bindingInput: unknown, idInput: unknown): RetainedSource {
    const binding = pinBinding(bindingInput, this.workspace), id = entityId(idInput);
    return this.#locked(() => transaction(this.#handle, false,
      () => readPinnedInlineSource(this.#handle.db, binding, id, { owner_id: this.owner_id, process_instance: this.process_instance }),
      () => this.#guard()));
  }
  releaseSourcePin(bindingInput: unknown, idInput: unknown): boolean {
    const binding = pinBinding(bindingInput, this.workspace), id = entityId(idInput);
    return this.#locked(() => transaction(this.#handle, true,
      () => releaseSourcePin(this.#handle.db, binding, id, { owner_id: this.owner_id, process_instance: this.process_instance }),
      () => this.#guard()));
  }
  /** Reconcile one inline pin only after inspecting its original storage owner.
   * No process-death claim, owner retirement, job transition or content deletion. */
  recoverSourcePin(bindingInput: unknown, idInput: unknown): SourcePinRecovery {
    const binding = pinBinding(bindingInput, this.workspace), id = entityId(idInput);
    return this.#locked(() => {
      let recoveryFile: OwnerFile | undefined;
      try {
        return transaction(this.#handle, true, () => {
          const pin = loadSourcePin(this.#handle.db, binding, id);
          if (!pin) throw new StorageError('E_CONFLICT', 'source pin not found');
          const original = readOwner(this.#handle, pin.owner_id);
          if (!original || original.process_instance !== pin.process_instance) return capability();
          if (pin.state === 'released') return Object.freeze({ state: 'released' as const, pin });
          if (original.state !== 'active') throw new StorageError('E_STORAGE', 'active pin has retired owner');
          // The current participant owns a live handle; never inspect it reentrantly.
          if (original.owner_id === this.owner_id) return Object.freeze({ state: 'held' as const, pin });
          recoveryFile = this.#resources.owner(original.owner_id, false);
          if (!sameFile(recoveryFile.identity, original.identity)) return capability();
          if (!recoveryFile.tryLock()) return Object.freeze({ state: 'held' as const, pin });
          // Reuse the exact owner-scoped release; the recoveryFile lock lasts through COMMIT.
          releaseSourcePin(this.#handle.db, binding, id, original);
          return Object.freeze({ state: 'released' as const, pin: loadSourcePin(this.#handle.db, binding, id)! });
        }, () => { this.#guard(); recoveryFile?.guard(); });
      } finally { recoveryFile?.close(); }
    });
  }
  /** Retirement is only storage-record reconciliation, never permission to clean a job. */
  retireOwner(idInput: unknown): OwnerInspection {
    const id = entityId(idInput);
    return this.#locked(() => {
      let inspected: OwnerFile | undefined;
      try {
        return transaction(this.#handle, true, () => {
          const row = readOwner(this.#handle, id);
          if (!row) return Object.freeze({ state: 'absent' as const, owner: null });
          if (id === this.owner_id) return Object.freeze({ state: 'held' as const, owner: row });
          if (row.state === 'retired') return Object.freeze({ state: 'retired' as const, owner: row });
          inspected = this.#resources.owner(id, false);
          if (!sameFile(inspected.identity, row.identity)) return capability();
          if (!inspected.tryLock()) return Object.freeze({ state: 'held' as const, owner: row });
          noReservations(this.#handle, id);
          const changed = this.#handle.db.prepare("UPDATE storage_owners SET state='retired' WHERE owner_id=? AND state='active'").run(id);
          if (changed.changes !== 1) throw new StorageError('E_CONFLICT', 'owner retirement changed');
          return Object.freeze({ state: 'retired' as const, owner: readOwner(this.#handle, id)! });
        }, () => { this.#guard(); inspected?.guard(); });
      } finally { inspected?.close(); }
    });
  }
  /** Revocation is immediate even if retirement cannot commit. Always attempts cleanup. */
  close(): void {
    if (this.#closed) return;
    if (this.#busy) throw new StorageError('E_CONFLICT', 'cannot close a borrowed coordinator');
    this.#closed = true;
    let failure: unknown, acquired = false;
    try {
      this.#resources.acquire(); acquired = true; this.#guard();
      transaction(this.#handle, true, () => {
        noReservations(this.#handle, this.owner_id);
        const changed = this.#handle.db.prepare("UPDATE storage_owners SET state='retired' WHERE owner_id=? AND state='active'").run(this.owner_id);
        if (changed.changes !== 1) throw new StorageError('E_CONFLICT', 'owner retirement changed');
      }, () => { checkAnchor(this.#handle, this.#resources); this.#owner.guard(); });
    } catch (cause) { failure = cause; }
    finally {
      try { if (acquired) this.#resources.release(); } catch (cause) { failure ??= cause; }
      try { this.#resources.close(); } catch (cause) { failure ??= cause; }
      try { this.#handle.db.close(); } catch (cause) { failure ??= cause; }
    }
    if (failure !== undefined) storageFailure(failure);
  }
}
