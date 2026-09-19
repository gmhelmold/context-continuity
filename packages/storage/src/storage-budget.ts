/** SPEC-23: logical workspace accounting, not a filesystem audit or reservation. */
import type { DatabaseSync } from 'node:sqlite';
import { StorageError, storageFailure } from './errors.ts';

export const WORKSPACE_CONTENT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export type StorageBudget = Readonly<{
  quota_bytes: number; inline_bytes: number; blob_bytes: number; reserved_bytes: number;
  used_bytes: number; remaining_bytes: number; over_quota: boolean;
}>;
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new StorageError('E_STORAGE', 'storage accounting invalid');
  }
  return value === 0 ? 0 : value;
}
function aggregate(row: Record<string, unknown> | undefined): number {
  if (!row || count(row.invalid) !== 0) throw new StorageError('E_STORAGE', 'storage accounting invalid');
  return count(row.bytes);
}
function sizedRows(db: DatabaseSync, table: 'blobs' | 'storage_reservations'): number {
  // The identifier is internal and fixed; no SQL or table name comes from callers.
  return aggregate(db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN typeof(size_bytes)='integer' AND size_bytes>=0 THEN size_bytes ELSE 0 END),0) AS bytes,
    COALESCE(SUM(CASE WHEN typeof(size_bytes)='integer' AND size_bytes>=0 THEN 0 ELSE 1 END),0) AS invalid
    FROM ${table}`).get());
}
/** Three scalar aggregates share the caller's transaction. No cache survives it.
 * A read snapshot reports capacity; a write admission must read again under IMMEDIATE. */
export function readWorkspaceBudget(db: DatabaseSync): StorageBudget {
  try {
    if (!db.isTransaction) throw new StorageError('E_STORAGE', 'storage accounting requires transaction');
    const inline_bytes = aggregate(db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN typeof(inline_bytes)='blob' THEN length(inline_bytes) ELSE 0 END),0) AS bytes,
      COALESCE(SUM(CASE WHEN inline_bytes IS NULL OR
        (availability='captured' AND typeof(inline_bytes)='blob') THEN 0 ELSE 1 END),0) AS invalid
      FROM sources`).get());
    const blob_bytes = sizedRows(db, 'blobs');
    const reserved_bytes = sizedRows(db, 'storage_reservations');
    const used_bytes = count(count(inline_bytes + blob_bytes) + reserved_bytes);
    const quota_bytes = WORKSPACE_CONTENT_QUOTA_BYTES;
    return Object.freeze({ quota_bytes, inline_bytes, blob_bytes, reserved_bytes, used_bytes,
      remaining_bytes: Math.max(0, quota_bytes - used_bytes), over_quota: used_bytes > quota_bytes });
  } catch (cause) { return storageFailure(cause); }
}
/** Private write-path precondition, not a permit and not a persisted reservation.
 * The caller keeps its IMMEDIATE transaction through the associated insert. */
export function assertStorageCapacity(db: DatabaseSync, additionalBytes: number): void {
  const bytes = count(additionalBytes);
  const budget = readWorkspaceBudget(db);
  if (budget.over_quota || bytes > budget.remaining_bytes) {
    throw new StorageError('E_BUDGET', 'workspace content quota exceeded');
  }
}
