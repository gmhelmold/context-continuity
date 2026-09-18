/** SPEC-12 structural SnapshotRecord. Projection evidence is supplied by the
 * authorized producer; this parser does not certify an EffectiveFrame or dispatch. */
import { Buffer } from 'node:buffer';
import { canonical } from './canonical.mjs';
import { closedRecord, ContractError, integer } from './validation.ts';
import { digestValue, entityId, hashPayload, parseWorkContext } from './identity.ts';
import type { WorkContext } from './identity.ts';
import { MAX_CATALOG_ROOTS, parseRootRef } from './roots.ts';
import type { RootRef } from './roots.ts';
import { parseEntityRef } from './manifest.ts';
import type { EntityRef } from './manifest.ts';
import { dataList, distinct } from './contract-data.ts';
export const MAX_JOB_RECORD_BYTES = 16 * 1024 * 1024;
export type SnapshotRecord = Readonly<{
  schema_version: 1; snapshot_id: string; session_key: string; incarnation: string;
  host_epoch: number; view_revision: number; policy_revision: number; owner_fence: number;
  frame_id: string; logical_coverage: readonly string[]; root_coverage: readonly RootRef[];
  read_dependencies: readonly EntityRef[]; prefix_digest: string; coverage_digest: string;
  config_digest: string; effective_input_digest: string; manifest_id: string;
  manifest_digest: string; feedback_ids: readonly string[]; work: WorkContext; created_at: string;
}>;
export type SnapshotFields = Omit<SnapshotRecord, 'schema_version' | 'snapshot_id' | 'session_key' | 'incarnation' | 'host_epoch' | 'manifest_id' | 'manifest_digest'>;
export const SNAPSHOT_INPUT_FIELDS = Object.freeze([
  'view_revision', 'policy_revision', 'owner_fence', 'frame_id', 'logical_coverage',
  'root_coverage', 'read_dependencies', 'prefix_digest', 'coverage_digest', 'config_digest',
  'effective_input_digest', 'feedback_ids', 'work', 'created_at',
] as const);
const FIELDS = ['schema_version', 'snapshot_id', 'session_key', 'incarnation', 'host_epoch',
  'manifest_id', 'manifest_digest', ...SNAPSHOT_INPUT_FIELDS];
const MAX = Number.MAX_SAFE_INTEGER;
function timestamp(input: unknown): string {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) {
    throw new ContractError('snapshot.created_at', 'expected canonical UTC timestamp');
  }
  const date = new Date(input);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== input) throw new ContractError('snapshot.created_at', 'invalid calendar value');
  return input;
}
function ids(input: unknown, max: number, field: string): readonly string[] {
  const result = dataList(input, max, field).map(value => entityId(value, field));
  distinct(result, value => value, field);
  return Object.freeze(result);
}
function dependencies(input: unknown): readonly EntityRef[] {
  const values = dataList(input, MAX_CATALOG_ROOTS, 'snapshot.read_dependencies').map(parseEntityRef);
  distinct(values, hashPayload, 'snapshot.read_dependencies');
  const definitions = new Map<string, string>();
  for (const e of values) {
    const coordinate = e.kind === 'source' ? `source:${e.ref.source_id}:${e.ref.revision}`
      : e.kind === 'block' ? `block:${e.ref.block_id}:${e.ref.version}` : `chapter:${e.ref.chapter_id}`;
    const previous = definitions.get(coordinate);
    if (previous !== undefined && previous !== e.ref.digest) throw new ContractError('snapshot.read_dependencies', 'contradictory version');
    definitions.set(coordinate, e.ref.digest);
  }
  return Object.freeze(values);
}
/** Schema validation returns data, not a verified frame or publication capability. */
export function parseSnapshotRecord(input: unknown): SnapshotRecord {
  const v = closedRecord(input, FIELDS, FIELDS, 'snapshot');
  integer(v.schema_version, 1, 1, 'snapshot.schema_version');
  const logical = ids(v.logical_coverage, MAX_CATALOG_ROOTS, 'snapshot.logical_coverage');
  const roots = dataList(v.root_coverage, MAX_CATALOG_ROOTS, 'snapshot.root_coverage').map(parseRootRef);
  distinct(roots, r => r.unit_id, 'snapshot.root_coverage');
  if (!logical.length || !roots.length) throw new ContractError('snapshot.coverage', 'nonempty coverage required');
  const result: SnapshotRecord = Object.freeze({
    schema_version: 1, snapshot_id: entityId(v.snapshot_id), session_key: digestValue(v.session_key),
    incarnation: entityId(v.incarnation), host_epoch: integer(v.host_epoch, 0, MAX, 'snapshot.host_epoch'),
    view_revision: integer(v.view_revision, 0, MAX, 'snapshot.view_revision'),
    policy_revision: integer(v.policy_revision, 0, MAX, 'snapshot.policy_revision'),
    owner_fence: integer(v.owner_fence, 0, MAX, 'snapshot.owner_fence'), frame_id: entityId(v.frame_id),
    logical_coverage: logical, root_coverage: Object.freeze(roots), read_dependencies: dependencies(v.read_dependencies),
    prefix_digest: digestValue(v.prefix_digest), coverage_digest: digestValue(v.coverage_digest),
    config_digest: digestValue(v.config_digest), effective_input_digest: digestValue(v.effective_input_digest),
    manifest_id: entityId(v.manifest_id), manifest_digest: digestValue(v.manifest_digest),
    feedback_ids: ids(v.feedback_ids, 32, 'snapshot.feedback_ids'), work: parseWorkContext(v.work), created_at: timestamp(v.created_at),
  });
  if (Buffer.byteLength(canonical(result), 'utf8') > MAX_JOB_RECORD_BYTES) throw new ContractError('snapshot', 'byte limit exceeded');
  return result;
}
