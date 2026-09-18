/** Inline source persistence. Called only within the session store transaction. */
import type { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import { canonical, parseJSON } from '../../core/src/canonical.mjs';
import { hashSource, opaqueId } from '../../core/src/identity.ts';
import type { SessionBinding } from '../../core/src/identity.ts';
import { parseSourceRef } from '../../core/src/roots.ts';
import type { SourceRef } from '../../core/src/roots.ts';
import { dataList, distinct } from '../../core/src/contract-data.ts';
import { closedRecord, ContractError, integer } from '../../core/src/validation.ts';
import { StorageError } from './errors.ts';

export const MAX_INLINE_SOURCE_BYTES = 256 * 1024;
export const WORKSPACE_CONTENT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export type InlineSource = Readonly<{ ref: SourceRef; native_refs: readonly string[]; media_type: string; bytes: Uint8Array }>;
export type RetainedSource = InlineSource & Readonly<{ policy_revision: number }>;
function nativeRefs(input: unknown): readonly string[] {
  const refs = dataList(input, 1024, 'source.native_refs').map(v => opaqueId(v, 'source.native_ref'));
  if (!refs.length) throw new ContractError('source.native_refs', 'expected public references');
  distinct(refs, v => v, 'source.native_refs');
  return Object.freeze(refs);
}
export function prepareSource(input: unknown): InlineSource {
  const fields = ['ref', 'native_refs', 'media_type', 'bytes'];
  const v = closedRecord(input, fields, fields, 'source');
  const ref = parseSourceRef(v.ref);
  if (!(v.bytes instanceof Uint8Array) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(v.bytes)) ||
      v.bytes.buffer instanceof SharedArrayBuffer) throw new ContractError('source.bytes', 'expected owned byte array');
  if (v.bytes.byteLength > MAX_INLINE_SOURCE_BYTES) throw new StorageError('E_CAPABILITY', 'external source storage not implemented');
  const bytes = Buffer.from(v.bytes);
  if (hashSource(bytes) !== ref.digest) throw new StorageError('E_SOURCE', 'source bytes do not match reference');
  return Object.freeze({ ref, native_refs: nativeRefs(v.native_refs), media_type: opaqueId(v.media_type, 'source.media_type'), bytes });
}
/** Every returned byte array is an owned copy, not a mutable alias of persisted data. */
export function loadSource(db: DatabaseSync, binding: SessionBinding, input: SourceRef): RetainedSource {
  const ref = parseSourceRef(input);
  const row = db.prepare('SELECT * FROM sources WHERE session_key=? AND source_id=? AND revision=?')
    .get(binding.session_key, ref.source_id, ref.revision);
  if (!row || row.availability !== 'captured') throw new StorageError('E_SOURCE', 'source unavailable');
  if (row.digest !== ref.digest || row.blob_key !== null || !(row.inline_bytes instanceof Uint8Array)) {
    throw new StorageError('E_SOURCE', 'source identity or inline representation mismatch');
  }
  const bytes = Buffer.from(row.inline_bytes);
  if (bytes.length > MAX_INLINE_SOURCE_BYTES || row.size_bytes !== bytes.length || hashSource(bytes) !== ref.digest) {
    throw new StorageError('E_SOURCE', 'source integrity mismatch');
  }
  if (typeof row.native_refs_json !== 'string') throw new StorageError('E_STORAGE', 'source record invalid');
  return Object.freeze({ ref, bytes, native_refs: nativeRefs(parseJSON(row.native_refs_json)),
    media_type: opaqueId(row.media_type), policy_revision: integer(row.policy_revision, 0, Number.MAX_SAFE_INTEGER, 'source.policy') });
}
function accountedBytes(db: DatabaseSync): number {
  const inline = db.prepare("SELECT COALESCE(SUM(length(inline_bytes)),0) AS n FROM sources WHERE availability='captured'").get()!.n;
  const blobs = db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS n FROM blobs').get()!.n;
  const reservations = db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS n FROM storage_reservations').get()!.n;
  const count = (value: unknown) => integer(value, 0, Number.MAX_SAFE_INTEGER, 'storage.accounting');
  return count(count(inline) + count(blobs) + count(reservations));
}
export function retainSource(db: DatabaseSync, binding: SessionBinding, source: InlineSource, policy: number, created: string): void {
  const { ref } = source;
  const existing = db.prepare('SELECT revision FROM sources WHERE session_key=? AND source_id=? AND revision=?')
    .get(binding.session_key, ref.source_id, ref.revision);
  if (existing) {
    const stored = loadSource(db, binding, ref);
    if (canonical(stored.native_refs) !== canonical(source.native_refs) || stored.media_type !== source.media_type ||
        !Buffer.from(stored.bytes).equals(source.bytes)) throw new StorageError('E_CONFLICT', 'source revision already defined');
    return;
  }
  const latest = db.prepare('SELECT MAX(revision) AS revision FROM sources WHERE session_key=? AND source_id=?')
    .get(binding.session_key, ref.source_id)!.revision;
  if (latest !== null) {
    const previous = integer(latest, 0, Number.MAX_SAFE_INTEGER, 'source.revision');
    const status = db.prepare('SELECT availability FROM sources WHERE session_key=? AND source_id=? AND revision=?')
      .get(binding.session_key, ref.source_id, previous)!.availability;
    if (status !== 'captured') throw new StorageError('E_SOURCE', 'source lifecycle requires authorized recovery');
    if (previous === Number.MAX_SAFE_INTEGER || ref.revision !== previous + 1) throw new StorageError('E_CONFLICT', 'source revision gap');
  } else if (ref.revision !== 0) throw new StorageError('E_CONFLICT', 'source must begin at revision zero');
  if (accountedBytes(db) + source.bytes.length > WORKSPACE_CONTENT_QUOTA_BYTES) throw new StorageError('E_BUDGET', 'workspace content quota exceeded');
  db.prepare(`INSERT INTO sources(session_key,source_id,revision,digest,native_refs_json,availability,media_type,size_bytes,inline_bytes,blob_key,policy_revision,created_at)
    VALUES (?,?,?,?,?,'captured',?,?,?,NULL,?,?)`).run(binding.session_key, ref.source_id, ref.revision, ref.digest,
      canonical(source.native_refs), source.media_type, source.bytes.length, source.bytes, policy, created);
}
