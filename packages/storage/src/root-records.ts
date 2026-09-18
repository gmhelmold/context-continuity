/** Durable root revisions. Private SQL helpers; no public arbitrary query surface. */
import type { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import { canonical, parseJSON } from '../../core/src/canonical.mjs';
import { digestValue, hashPayload, opaqueId } from '../../core/src/identity.ts';
import type { SessionBinding } from '../../core/src/identity.ts';
import { MAX_CATALOG_ROOTS, RootIdentityRegistry, parseRootRef, parseRootUnit } from '../../core/src/roots.ts';
import type { RootCatalog, RootEntry, RootRef, RootUnit, RootObservation } from '../../core/src/roots.ts';
import { dataList, distinct, ownJSON } from '../../core/src/contract-data.ts';
import { closedRecord } from '../../core/src/validation.ts';
import { loadSource, prepareSource, retainSource } from './source-records.ts';
import type { InlineSource } from './source-records.ts';
import { StorageError } from './errors.ts';

export const MAX_RETENTION_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
export type RootRetentionBatch = Readonly<{
  expected_catalog_digest: string; sources: readonly InlineSource[]; observations: readonly RootObservation[];
}>;
export function prepareRootBatch(binding: SessionBinding, input: unknown): RootRetentionBatch {
  const fields = ['expected_catalog_digest', 'sources', 'observations'];
  const v = closedRecord(input, fields, fields, 'root_batch');
  const sources = dataList(v.sources, 64, 'root_batch.sources').map(prepareSource);
  distinct(sources, s => s.ref.source_id + ':' + s.ref.revision, 'root_batch.sources');
  const raw = ownJSON(dataList(v.observations, 128, 'root_batch.observations'), 'observations', MAX_RETENTION_BATCH_BYTES);
  const observations = raw as unknown as readonly RootObservation[];
  if (sources.reduce((n, s) => n + s.bytes.length + Buffer.byteLength(canonical({ ref: s.ref, native_refs: s.native_refs, media_type: s.media_type })), 0) +
      Buffer.byteLength(canonical(observations)) > MAX_RETENTION_BATCH_BYTES) throw new StorageError('E_BUDGET', 'retention batch too large');
  const check = new RootIdentityRegistry(binding);
  for (const observation of observations) check.observe(observation);
  distinct(observations, o => o.native_identity, 'root_batch.observations');
  return Object.freeze({ expected_catalog_digest: digestValue(v.expected_catalog_digest), sources: Object.freeze(sources), observations });
}
function decodedRow(row: Record<string, unknown>): RootEntry {
  if (typeof row.record_json !== 'string' || Buffer.byteLength(row.record_json) > MAX_RETENTION_BATCH_BYTES) throw new StorageError('E_STORAGE', 'root record invalid');
  const unit = parseRootUnit(parseJSON(row.record_json));
  if (row.unit_id !== unit.unit_id || row.revision !== unit.revision || row.unit_digest !== unit.unit_digest || row.payload_digest !== unit.payload_digest) {
    throw new StorageError('E_STORAGE', 'root columns disagree with record');
  }
  return Object.freeze({ native_identity: opaqueId(row.native_identity), unit });
}
function catalog(binding: SessionBinding, input: readonly RootEntry[]): RootCatalog {
  const entries = [...input].sort((a, b) => a.native_identity < b.native_identity ? -1 : a.native_identity > b.native_identity ? 1 : 0);
  const body = { schema_version: 1 as const, binding, entries };
  if (entries.length > MAX_CATALOG_ROOTS || Buffer.byteLength(canonical(body)) > MAX_CATALOG_BYTES) throw new StorageError('E_BUDGET', 'root catalog limit exceeded');
  return new RootIdentityRegistry(binding, { ...body, catalog_digest: hashPayload(body) }).exportState();
}
function verifySources(db: DatabaseSync, binding: SessionBinding, unit: RootUnit, seen: Set<string>): void {
  for (const ref of unit.source_refs) {
    const key = canonical(ref);
    if (!seen.has(key)) { loadSource(db, binding, ref); seen.add(key); }
  }
}
/** The storage catalog is deterministically ordered; it is never prompt chronology. */
export function loadRootCatalog(db: DatabaseSync, binding: SessionBinding): RootCatalog {
  const statement = db.prepare(`SELECT r.* FROM root_units r JOIN
    (SELECT native_identity,MAX(revision) AS latest FROM root_units WHERE session_key=? AND host_epoch=? GROUP BY native_identity) c
    ON c.native_identity=r.native_identity AND c.latest=r.revision
    WHERE r.session_key=? AND r.host_epoch=? LIMIT ?`);
  const entries: RootEntry[] = [], verified = new Set<string>();
  let bytes = 0;
  for (const row of statement.iterate(binding.session_key, binding.host_epoch, binding.session_key, binding.host_epoch, MAX_CATALOG_ROOTS + 1)) {
    const entry = decodedRow(row);
    bytes += Buffer.byteLength(canonical(entry));
    if (entries.length >= MAX_CATALOG_ROOTS || bytes > MAX_CATALOG_BYTES) throw new StorageError('E_BUDGET', 'root catalog limit exceeded');
    verifySources(db, binding, entry.unit, verified); entries.push(entry);
  }
  return catalog(binding, entries);
}
export function loadRoot(db: DatabaseSync, binding: SessionBinding, input: RootRef): RootUnit | null {
  const ref = parseRootRef(input);
  const row = db.prepare('SELECT * FROM root_units WHERE session_key=? AND host_epoch=? AND unit_id=? AND revision=?')
    .get(binding.session_key, binding.host_epoch, ref.unit_id, ref.revision);
  if (!row) return null;
  const { unit } = decodedRow(row);
  if (unit.unit_digest !== ref.unit_digest) throw new StorageError('E_SOURCE', 'root reference does not match');
  verifySources(db, binding, unit, new Set());
  return unit;
}
/** All inserts and the expected catalog check share the caller's IMMEDIATE transaction. */
export function retainRootBatch(db: DatabaseSync, binding: SessionBinding, input: RootRetentionBatch, policy: number, created: string): RootCatalog {
  const before = loadRootCatalog(db, binding);
  if (before.catalog_digest !== input.expected_catalog_digest) throw new StorageError('E_CONFLICT', 'root catalog changed');
  for (const source of input.sources) retainSource(db, binding, source, policy, created);
  const registry = new RootIdentityRegistry(binding, before), verified = new Set<string>();
  for (const observation of input.observations) {
    const result = registry.observe(observation), unit = result.unit;
    verifySources(db, binding, unit, verified);
    if (result.change === 'unchanged') continue;
    if (result.change === 'metadata') {
      const changed = db.prepare(`UPDATE root_units SET record_json=?
        WHERE session_key=? AND host_epoch=? AND native_identity=? AND unit_id=? AND revision=? AND unit_digest=?`)
        .run(canonical(unit), binding.session_key, binding.host_epoch, observation.native_identity, unit.unit_id, unit.revision, unit.unit_digest);
      if (changed.changes !== 1) throw new StorageError('E_CONFLICT', 'root metadata update failed');
    } else {
      db.prepare(`INSERT INTO root_units(session_key,host_epoch,native_identity,unit_id,revision,unit_digest,payload_digest,record_json)
        VALUES (?,?,?,?,?,?,?,?)`).run(binding.session_key, binding.host_epoch, observation.native_identity, unit.unit_id, unit.revision, unit.unit_digest, unit.payload_digest, canonical(unit));
    }
  }
  return catalog(binding, registry.exportState().entries);
}
