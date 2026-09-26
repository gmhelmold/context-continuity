/** SPEC-24: pre-file capacity intents. No filesystem, recovery or writer authority. */
import { Buffer } from 'node:buffer';
import type { DatabaseSync } from 'node:sqlite';
import { canonical, parseJSON } from '../../core/src/canonical.mjs';
import { createSessionBinding, entityId, hashPayload, parseSessionBinding } from '../../core/src/identity.ts';
import type { SessionBinding } from '../../core/src/identity.ts';
import { choice, closedRecord, integer } from '../../core/src/validation.ts';
import type { WorkspaceIdentity } from './sqlite-database.ts';
import { StorageError } from './errors.ts';
import { hasSourcePinHistory, stagingIntentMetaKey } from './reservation-metadata.ts';
import { assertStorageCapacity } from './storage-budget.ts';

export const MAX_ACTIVE_STAGING_INTENTS = 4096;
export const MAX_STAGING_INTENT_BYTES = 16 * 1024 * 1024;
export type StagingIntentRequest = Readonly<{
  reservation_id: string; operation_id: string; max_bytes: number; expected_policy_revision: number;
}>;
export type StagingIntent = StagingIntentRequest & Readonly<{
  schema_version: 1; binding: SessionBinding; owner_id: string; process_instance: string;
  policy_revision: number; state: 'reserved' | 'cancelled'; created_at: string;
}>;
type StagingOwner = Readonly<{ owner_id: string; process_instance: string }>;

const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const envelope = (value: StagingIntent): string => canonical({ value, digest: hashPayload(value) });
function invalid(): never { throw new StorageError('E_STORAGE', 'staging intent records inconsistent'); }

export function stagingBinding(input: unknown, workspace: WorkspaceIdentity): SessionBinding {
  const binding = parseSessionBinding(input);
  if (binding.scope.installation_id !== workspace.installation_id || binding.scope.workspace_id !== workspace.workspace_id) {
    throw new StorageError('E_SCOPE', 'staging intent workspace mismatch');
  }
  return binding;
}

export function parseStagingIntentRequest(input: unknown): StagingIntentRequest {
  const fields = ['reservation_id', 'operation_id', 'max_bytes', 'expected_policy_revision'];
  const record = closedRecord(input, fields, fields, 'staging_intent');
  return Object.freeze({
    reservation_id: entityId(record.reservation_id),
    operation_id: entityId(record.operation_id),
    max_bytes: integer(record.max_bytes, 1, MAX_STAGING_INTENT_BYTES, 'staging_intent.max_bytes'),
    expected_policy_revision: integer(record.expected_policy_revision, 0, Number.MAX_SAFE_INTEGER, 'staging_intent.expected_policy_revision'),
  });
}

function parseIntent(input: unknown): StagingIntent {
  const fields = ['schema_version', 'reservation_id', 'operation_id', 'max_bytes', 'expected_policy_revision',
    'binding', 'owner_id', 'process_instance', 'policy_revision', 'state', 'created_at'];
  const record = closedRecord(input, fields, fields, 'stored_staging_intent');
  integer(record.schema_version, 1, 1, 'stored_staging_intent.version');
  const request = parseStagingIntentRequest({ reservation_id: record.reservation_id, operation_id: record.operation_id,
    max_bytes: record.max_bytes, expected_policy_revision: record.expected_policy_revision });
  if (typeof record.created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.created_at) ||
      !Number.isFinite(Date.parse(record.created_at)) || new Date(record.created_at).toISOString() !== record.created_at) return invalid();
  return Object.freeze({ ...request, schema_version: 1, binding: parseSessionBinding(record.binding),
    owner_id: entityId(record.owner_id), process_instance: entityId(record.process_instance),
    policy_revision: integer(record.policy_revision, 0, Number.MAX_SAFE_INTEGER, 'stored_staging_intent.policy'),
    state: choice(record.state, ['reserved', 'cancelled'] as const, 'stored_staging_intent.state'), created_at: record.created_at });
}

/** Caller keeps one transaction across scalar preflight, value transfer and row checks. */
function readStagingIntentRecord(db: DatabaseSync, id: string): StagingIntent | null {
  const key = stagingIntentMetaKey(id);
  const size = db.prepare('SELECT typeof(value) AS storage_type, octet_length(value) AS size_bytes FROM meta WHERE key=?').get(key);
  if (size && (size.storage_type !== 'text' || typeof size.size_bytes !== 'number' ||
      !Number.isSafeInteger(size.size_bytes) || size.size_bytes < 0 || size.size_bytes > 16384)) return invalid();
  if (size && db.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') return invalid();
  const metadata = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  const row = db.prepare('SELECT * FROM storage_reservations WHERE reservation_id=?').get(id);
  if (!metadata) { if (size || row) return invalid(); return null; }
  let intent: StagingIntent;
  try {
    if (!size || typeof metadata.value !== 'string' || Buffer.byteLength(metadata.value) > 16384 ||
        Buffer.byteLength(metadata.value) !== size.size_bytes) return invalid();
    const stored = parseJSON(metadata.value);
    if (canonical(stored) !== metadata.value) return invalid();
    const record = closedRecord(stored, ['value', 'digest'], ['value', 'digest'], 'staging_intent_envelope');
    intent = parseIntent(record.value);
    if (record.digest !== hashPayload(intent) || intent.reservation_id !== id) return invalid();
    if (intent.state === 'cancelled') {
      if (row) return invalid();
    } else if (!row || !equal(row, {
      reservation_id: id, owner_id: intent.owner_id, operation_id: intent.operation_id, staging_path_key: null,
      kind: 'staging', blob_digest: null, session_key: intent.binding.session_key, incarnation: intent.binding.incarnation,
      size_bytes: intent.max_bytes, created_at: intent.created_at,
    })) return invalid();
    const owner = db.prepare('SELECT process_instance,state FROM storage_owners WHERE owner_id=?').get(intent.owner_id);
    if (!owner || owner.process_instance !== intent.process_instance) return invalid();
    const state = choice(owner.state, ['active', 'retired'] as const, 'staging_intent.owner_state');
    if (intent.state === 'reserved' && state !== 'active') return invalid();
  } catch { return invalid(); }
  return intent;
}

export function loadStagingIntent(db: DatabaseSync, binding: SessionBinding, id: string): StagingIntent | null {
  const intent = readStagingIntentRecord(db, id);
  if (intent && !equal(intent.binding, binding)) throw new StorageError('E_SCOPE', 'staging intent session mismatch');
  return intent;
}

function currentPolicy(db: DatabaseSync, binding: SessionBinding): number {
  if (db.prepare('SELECT 1 FROM tombstones WHERE scope_hash=? LIMIT 1').get(binding.session_key)) {
    throw new StorageError('E_SCOPE', 'staging intent session has retained tombstone');
  }
  if (db.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') return invalid();
  const row = db.prepare(`SELECT typeof(scope_json) AS scope_storage_type, octet_length(scope_json) AS scope_size_bytes,
    CASE WHEN typeof(scope_json)='text' AND octet_length(scope_json) <= 16384 THEN scope_json END AS scope_json,
    incarnation,host_epoch,policy_revision FROM sessions WHERE session_key=?`).get(binding.session_key);
  if (!row) throw new StorageError('E_SCOPE', 'staging intent session absent or superseded');
  try {
    if (row.scope_storage_type !== 'text' || typeof row.scope_size_bytes !== 'number' ||
        !Number.isSafeInteger(row.scope_size_bytes) || row.scope_size_bytes < 0 || row.scope_size_bytes > 16384 ||
        typeof row.scope_json !== 'string' || Buffer.byteLength(row.scope_json) !== row.scope_size_bytes) return invalid();
    if (!equal(createSessionBinding(parseJSON(row.scope_json), row.incarnation, row.host_epoch), binding)) {
      throw new StorageError('E_SCOPE', 'staging intent session absent or superseded');
    }
    return integer(row.policy_revision, 0, Number.MAX_SAFE_INTEGER, 'staging_intent.policy');
  } catch (cause) {
    if (cause instanceof StorageError) throw cause;
    return invalid();
  }
}

function owns(intent: StagingIntent, owner: StagingOwner): void {
  if (intent.owner_id !== owner.owner_id || intent.process_instance !== owner.process_instance) {
    throw new StorageError('E_OWNER', 'staging intent belongs to another participant');
  }
}

function rejectManagedOperation(db: DatabaseSync, operationId: string): void {
  if (db.prepare('SELECT 1 FROM managed_files WHERE operation_id=? LIMIT 1').get(operationId)) {
    throw new StorageError('E_CONFLICT', 'staging intent operation already has managed files');
  }
}

/** Caller holds workspace flock and BEGIN IMMEDIATE through insert and final owner guard. */
export function createStagingIntent(db: DatabaseSync, binding: SessionBinding, request: StagingIntentRequest, owner: StagingOwner): StagingIntent {
  if (hasSourcePinHistory(db, request.reservation_id)) throw new StorageError('E_CONFLICT', 'reservation identifier belongs to source pin history');
  const existing = readStagingIntentRecord(db, request.reservation_id);
  if (existing) {
    if (!equal(existing.binding, binding) || existing.state !== 'reserved' || existing.operation_id !== request.operation_id ||
        existing.max_bytes !== request.max_bytes || existing.expected_policy_revision !== request.expected_policy_revision) {
      throw new StorageError('E_CONFLICT', 'staging intent identifier already used');
    }
    owns(existing, owner);
    const policy = currentPolicy(db, binding);
    if (request.expected_policy_revision !== policy || existing.policy_revision !== policy) {
      throw new StorageError('E_CONFLICT', 'staging intent policy changed');
    }
    rejectManagedOperation(db, request.operation_id);
    return existing;
  }
  const policy = currentPolicy(db, binding);
  if (request.expected_policy_revision !== policy) throw new StorageError('E_CONFLICT', 'staging intent policy changed');
  rejectManagedOperation(db, request.operation_id);
  const count = db.prepare("SELECT count(*) AS n FROM storage_reservations WHERE kind='staging'").get()!.n;
  if (integer(count, 0, Number.MAX_SAFE_INTEGER, 'staging_intent.count') >= MAX_ACTIVE_STAGING_INTENTS) {
    throw new StorageError('E_BUDGET', 'active staging intent limit reached');
  }
  assertStorageCapacity(db, request.max_bytes);
  const intent: StagingIntent = Object.freeze({ ...request, schema_version: 1, binding, ...owner,
    policy_revision: policy, state: 'reserved', created_at: new Date().toISOString() });
  db.prepare(`INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,staging_path_key,kind,blob_digest,session_key,incarnation,size_bytes,created_at)
    VALUES (?,?,?,NULL,'staging',NULL,?,?,?,?)`).run(intent.reservation_id, intent.owner_id, intent.operation_id,
    binding.session_key, binding.incarnation, intent.max_bytes, intent.created_at);
  db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run(stagingIntentMetaKey(intent.reservation_id), envelope(intent));
  return loadStagingIntent(db, binding, intent.reservation_id)!;
}

/** Explicit owner-only cancellation. No files, blobs, jobs, sessions or owners are changed. */
export function cancelStagingIntent(db: DatabaseSync, binding: SessionBinding, id: string, owner: StagingOwner): boolean {
  const intent = loadStagingIntent(db, binding, id);
  if (!intent) throw new StorageError('E_CONFLICT', 'staging intent not found');
  owns(intent, owner);
  if (intent.state === 'cancelled') return false;
  rejectManagedOperation(db, intent.operation_id);
  const deleted = db.prepare('DELETE FROM storage_reservations WHERE reservation_id=? AND owner_id=?').run(id, owner.owner_id);
  const updated = db.prepare('UPDATE meta SET value=? WHERE key=? AND value=?')
    .run(envelope(Object.freeze({ ...intent, state: 'cancelled' })), stagingIntentMetaKey(id), envelope(intent));
  if (deleted.changes !== 1 || updated.changes !== 1) throw new StorageError('E_CONFLICT', 'staging intent cancellation changed');
  return true;
}

/** SPEC-25: caller proved the exact foreign owner lock is unheld and keeps it through COMMIT.
 * This is one identified pre-file reservation, never general owner recovery. */
export function recoverStagingIntent(db: DatabaseSync, binding: SessionBinding, id: string, owner: StagingOwner): StagingIntent {
  const intent = loadStagingIntent(db, binding, id);
  if (!intent) throw new StorageError('E_CONFLICT', 'staging intent not found');
  if (intent.state === 'cancelled') return intent;
  if (intent.owner_id !== owner.owner_id || intent.process_instance !== owner.process_instance) return invalid();
  rejectManagedOperation(db, intent.operation_id);
  const deleted = db.prepare(`DELETE FROM storage_reservations WHERE reservation_id=? AND owner_id=? AND operation_id=?
    AND kind='staging' AND staging_path_key IS NULL AND blob_digest IS NULL`).run(id, owner.owner_id, intent.operation_id);
  const cancelled = Object.freeze({ ...intent, state: 'cancelled' as const });
  const updated = db.prepare('UPDATE meta SET value=? WHERE key=? AND value=?')
    .run(envelope(cancelled), stagingIntentMetaKey(id), envelope(intent));
  if (deleted.changes !== 1 || updated.changes !== 1) throw new StorageError('E_CONFLICT', 'staging intent recovery changed');
  return loadStagingIntent(db, binding, id)!;
}
