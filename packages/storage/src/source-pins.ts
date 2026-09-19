/** SPEC-21: durable inline-source pins and bounded verified reads, not GC. */
import type { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import { canonical, parseJSON } from '../../core/src/canonical.mjs';
import { createSessionBinding, entityId, hashPayload, parseSessionBinding } from '../../core/src/identity.ts';
import type { SessionBinding } from '../../core/src/identity.ts';
import { parseSourceRef } from '../../core/src/roots.ts';
import type { SourceRef } from '../../core/src/roots.ts';
import { choice, closedRecord, integer } from '../../core/src/validation.ts';
import { sourceMetadata, loadSource } from './source-records.ts';
import type { RetainedSource } from './source-records.ts';
import type { WorkspaceIdentity } from './sqlite-database.ts';
import { StorageError } from './errors.ts';

export const MAX_ACTIVE_SOURCE_PINS = 4096;
export type SourcePinRequest = Readonly<{
  reservation_id: string; operation_id: string; kind: 'read_pin' | 'export_pin'; source_ref: SourceRef;
}>;
export type SourcePin = SourcePinRequest & Readonly<{
  schema_version: 1; binding: SessionBinding; owner_id: string; process_instance: string;
  policy_revision: number; state: 'active' | 'released'; created_at: string;
}>;
type PinOwner = Readonly<{ owner_id: string; process_instance: string }>;
const key = (id: string): string => `storage.source-pin.v1:${id}`;
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const envelope = (value: SourcePin): string => canonical({ value, digest: hashPayload(value) });
function invalid(): never { throw new StorageError('E_STORAGE', 'source pin records inconsistent'); }
export function pinBinding(input: unknown, workspace: WorkspaceIdentity): SessionBinding {
  const b = parseSessionBinding(input);
  if (b.scope.installation_id !== workspace.installation_id || b.scope.workspace_id !== workspace.workspace_id) {
    throw new StorageError('E_SCOPE', 'source pin workspace mismatch');
  }
  return b;
}
export function parseSourcePinRequest(input: unknown): SourcePinRequest {
  const fields = ['reservation_id', 'operation_id', 'kind', 'source_ref'];
  const r = closedRecord(input, fields, fields, 'source_pin');
  return Object.freeze({ reservation_id: entityId(r.reservation_id), operation_id: entityId(r.operation_id),
    kind: choice(r.kind, ['read_pin', 'export_pin'] as const, 'source_pin.kind'), source_ref: parseSourceRef(r.source_ref) });
}
function parsePin(input: unknown): SourcePin {
  const fields = ['schema_version', 'binding', 'owner_id', 'process_instance', 'policy_revision', 'state',
    'created_at', 'reservation_id', 'operation_id', 'kind', 'source_ref'];
  const r = closedRecord(input, fields, fields, 'stored_pin');
  integer(r.schema_version, 1, 1, 'stored_pin.version');
  const request = parseSourcePinRequest({ reservation_id: r.reservation_id, operation_id: r.operation_id,
    kind: r.kind, source_ref: r.source_ref });
  if (typeof r.created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.created_at) ||
      !Number.isFinite(Date.parse(r.created_at)) || new Date(r.created_at).toISOString() !== r.created_at) return invalid();
  return Object.freeze({ ...request, schema_version: 1, binding: parseSessionBinding(r.binding),
    owner_id: entityId(r.owner_id), process_instance: entityId(r.process_instance),
    policy_revision: integer(r.policy_revision, 0, Number.MAX_SAFE_INTEGER, 'stored_pin.policy'),
    state: choice(r.state, ['active', 'released'] as const, 'stored_pin.state'), created_at: r.created_at });
}
/** A pin describes a reservation; it cannot serve as a current read/publication permit. */
export function loadSourcePin(db: DatabaseSync, binding: SessionBinding, id: string): SourcePin | null {
  const metadata = db.prepare('SELECT value FROM meta WHERE key=?').get(key(id));
  const row = db.prepare('SELECT * FROM storage_reservations WHERE reservation_id=?').get(id);
  if (!metadata) { if (row) return invalid(); return null; }
  let pin: SourcePin;
  try {
    if (typeof metadata.value !== 'string' || Buffer.byteLength(metadata.value) > 16384) return invalid();
    const e = closedRecord(parseJSON(metadata.value), ['value', 'digest'], ['value', 'digest'], 'pin_envelope');
    pin = parsePin(e.value);
    if (e.digest !== hashPayload(pin) || pin.reservation_id !== id) return invalid();
    if (pin.state === 'released') { if (row) return invalid(); }
    else if (!row || !equal(row, {
      reservation_id: id, owner_id: pin.owner_id, operation_id: pin.operation_id, staging_path_key: null,
      kind: pin.kind, blob_digest: null, session_key: pin.binding.session_key, incarnation: pin.binding.incarnation,
      size_bytes: 0, created_at: pin.created_at,
    })) return invalid();
    const owner = db.prepare('SELECT process_instance FROM storage_owners WHERE owner_id=?').get(pin.owner_id);
    if (!owner || owner.process_instance !== pin.process_instance) return invalid();
  } catch { return invalid(); }
  if (!equal(pin.binding, binding)) throw new StorageError('E_SCOPE', 'source pin session mismatch');
  return pin;
}
function currentPolicy(db: DatabaseSync, binding: SessionBinding): number {
  if (db.prepare('SELECT 1 FROM tombstones WHERE scope_hash=? LIMIT 1').get(binding.session_key)) {
    throw new StorageError('E_SCOPE', 'source pin session has retained tombstone');
  }
  const row = db.prepare('SELECT scope_json,incarnation,host_epoch,policy_revision FROM sessions WHERE session_key=?').get(binding.session_key);
  if (!row || typeof row.scope_json !== 'string' ||
      !equal(createSessionBinding(parseJSON(row.scope_json), row.incarnation, row.host_epoch), binding)) {
    throw new StorageError('E_SCOPE', 'source pin session absent or superseded');
  }
  return integer(row.policy_revision, 0, Number.MAX_SAFE_INTEGER, 'source_pin.policy');
}
function owns(pin: SourcePin, owner: PinOwner): void {
  if (pin.owner_id !== owner.owner_id || pin.process_instance !== owner.process_instance) {
    throw new StorageError('E_OWNER', 'source pin belongs to another participant');
  }
}
/** Caller holds workspace flock and one SQLite transaction, with owner guard before COMMIT. */
export function createSourcePin(db: DatabaseSync, binding: SessionBinding, request: SourcePinRequest, owner: PinOwner): SourcePin {
  const existing = loadSourcePin(db, binding, request.reservation_id);
  if (existing) {
    owns(existing, owner);
    if (existing.state !== 'active' || existing.operation_id !== request.operation_id || existing.kind !== request.kind ||
        !equal(existing.source_ref, request.source_ref)) throw new StorageError('E_CONFLICT', 'source pin identifier already used');
  }
  const policy = currentPolicy(db, binding);
  sourceMetadata(db, binding, request.source_ref); // No BLOB materialization or new verification receipt.
  if (existing) {
    if (existing.policy_revision !== policy) throw new StorageError('E_CONFLICT', 'source pin policy changed');
    return existing;
  }
  const active = db.prepare("SELECT count(*) AS n FROM storage_reservations WHERE kind IN ('read_pin','export_pin')").get()!.n;
  if (integer(active, 0, Number.MAX_SAFE_INTEGER, 'source_pin.count') >= MAX_ACTIVE_SOURCE_PINS) {
    throw new StorageError('E_BUDGET', 'active source pin limit reached');
  }
  const pin: SourcePin = Object.freeze({ ...request, schema_version: 1, binding, ...owner,
    policy_revision: policy, state: 'active', created_at: new Date().toISOString() });
  db.prepare(`INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,kind,session_key,incarnation,size_bytes,created_at)
    VALUES (?,?,?,?,?,?,0,?)`).run(pin.reservation_id, pin.owner_id, pin.operation_id, pin.kind, binding.session_key, binding.incarnation, pin.created_at);
  db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(key(pin.reservation_id), envelope(pin));
  return loadSourcePin(db, binding, pin.reservation_id)!;
}
/** Explicit owner-only release. No content, byte quota, job or filesystem is modified. */
export function releaseSourcePin(db: DatabaseSync, binding: SessionBinding, id: string, owner: PinOwner): boolean {
  const pin = loadSourcePin(db, binding, id);
  if (!pin) throw new StorageError('E_CONFLICT', 'source pin not found');
  owns(pin, owner);
  if (pin.state === 'released') return false;
  const deleted = db.prepare('DELETE FROM storage_reservations WHERE reservation_id=? AND owner_id=?')
    .run(id, owner.owner_id);
  const updated = db.prepare('UPDATE meta SET value=? WHERE key=? AND value=?')
    .run(envelope(Object.freeze({ ...pin, state: 'released' })), key(id), envelope(pin));
  if (deleted.changes !== 1 || updated.changes !== 1) throw new StorageError('E_CONFLICT', 'source pin release changed');
  return true;
}
/** One bounded owned copy under the caller's read snapshot and live workspace lock.
 * Metadata pinning never skips byte verification, nor implies authorization after return. */
export function readPinnedInlineSource(db: DatabaseSync, binding: SessionBinding, id: string, owner: PinOwner): RetainedSource {
  const pinned = loadSourcePin(db, binding, id);
  if (!pinned || pinned.state !== 'active') throw new StorageError('E_CONFLICT', 'active source pin required for reading');
  owns(pinned, owner);
  if (pinned.policy_revision !== currentPolicy(db, binding)) throw new StorageError('E_CONFLICT', 'pinned read policy changed');
  return loadSource(db, binding, pinned.source_ref);
}
