/** Accounting fixtures: real SQLite, synthetic catalog rows, no external blob files. */
import { DatabaseSync } from 'node:sqlite';
import { SqliteSessionStore } from '../../packages/storage/src/index.ts';
import { createSessionBinding, hashSource, resolveConfig } from '../../packages/core/src/index.ts';
import { fixture, workspace, id, sql } from './coordinator-fixtures.mjs';
export { fixture, workspace, id, sql };
export const binding = (name = 'budget-A') => createSessionBinding({ ...workspace,
  adapter_id: 'budget-fixture', host_session_id: name }, id(3), 0);
export const config = resolveConfig({}, { context_window: 100000, output_reserve: 4096 });
export function source(n, input = 'x', revision = 0) {
  const bytes = Buffer.from(input);
  return { ref: { source_id: id(n), revision, digest: hashSource(bytes) },
    native_refs: ['budget-' + n], media_type: 'application/octet-stream', bytes };
}
export function retain(f, sources, lease = f.lease) {
  return f.s.retainRoots(lease, { expected_catalog_digest: f.s.readRootCatalog(lease.binding).catalog_digest,
    sources, observations: [] });
}
export function reserve(f, n, size, kind = 'staging') {
  sql(f, `INSERT OR IGNORE INTO storage_owners VALUES (?,?,'synthetic-budget-owner','active','2026-01-01T00:00:00.000Z')`, id(60000), id(60001));
  sql(f, `INSERT INTO storage_reservations(reservation_id,owner_id,operation_id,kind,size_bytes,created_at)
    VALUES (?,?,?,?,?,'2026-01-01T00:00:00.000Z')`, id(n), id(60000), id(n + 1000), kind, size);
}
export function blob(f, n, size) {
  sql(f, "INSERT INTO blobs VALUES (?,?,'2026-01-01T00:00:00.000Z')", n.toString(16).padStart(64, '0'), size);
}
export const snapshot = f => Object.fromEntries(['sources', 'blobs', 'storage_reservations', 'sessions',
  'root_units', 'jobs', 'attempts', 'aux_runs', 'views', 'meta', 'storage_owners']
  .map(table => [table, sql(f, `SELECT * FROM ${table} ORDER BY rowid`)]));
export function budgetFixture(action) {
  return fixture(f => {
    const c = f.open(), s = SqliteSessionStore.open(f.directory, workspace, () => 100000), b = binding();
    try {
      s.createSession(b, config);
      const state = { ...f, c, s, b, lease: s.acquireLease(b) };
      const result = action(state);
      if (result?.then) return result.finally(() => s.close());
      s.close(); return result;
    } catch (cause) { s.close(); throw cause; }
  });
}
export function writer(f, action) {
  const db = new DatabaseSync(f.path);
  try { return action(db); } finally { db.close(); }
}
