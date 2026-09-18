/** SPEC-12: immutable association of a generation with its admitted snapshot.
 * No scheduler, filesystem, network, retry counter, freshness or dispatch authority. */
import { Buffer } from 'node:buffer';
import { canonical } from './canonical.mjs';
import { closedRecord, ContractError, integer } from './validation.ts';
import { assertSessionBinding, digestValue, entityId, hashPayload, hashSource, newEntityId, parseSessionBinding } from './identity.ts';
import type { SessionBinding } from './identity.ts';
import { assertVerifiedManifest, parseManifest } from './manifest.ts';
import type { Manifest, VerifiedManifest } from './manifest.ts';
import { assertProposalContext, decodeProposal } from './proposal.ts';
import type { ValidatedProposal } from './proposal.ts';
import { MAX_JOB_RECORD_BYTES, parseSnapshotRecord, SNAPSHOT_INPUT_FIELDS } from './snapshot.ts';
import type { SnapshotRecord } from './snapshot.ts';

export const MAX_MISSION_BYTES = 256 * 1024;
export type JobContextRef = Readonly<{ job_id: string; snapshot_id: string; snapshot_digest: string; context_digest: string }>;
export type JobContextRecord = Readonly<{
  schema_version: 1; job_id: string; binding: SessionBinding; snapshot: SnapshotRecord;
  snapshot_digest: string; manifest: Manifest; mission: string; mission_digest: string; context_digest: string;
}>;
declare const contextBrand: unique symbol;
declare const resultBrand: unique symbol;
export type JobContext = Readonly<{ ref: JobContextRef; record: JobContextRecord; [contextBrand]: true }>;
export type JobProposal = Readonly<{ ref: JobContextRef; validated: ValidatedProposal; [resultBrand]: true }>;
const contexts = new WeakMap<object, VerifiedManifest>();
const results = new WeakSet<object>();
export class JobContextError extends Error {
  readonly code = 'E_STALE' as const;
  constructor() { super('job context: generation or snapshot mismatch'); this.name = 'JobContextError'; }
}
function missionText(input: unknown): string {
  if (typeof input !== 'string' || !input.isWellFormed() || !input.trim().length || Buffer.byteLength(input, 'utf8') > MAX_MISSION_BYTES) {
    throw new ContractError('mission', 'expected nonblank bounded UTF-8 text');
  }
  return input;
}
export function parseJobContextRef(input: unknown): JobContextRef {
  const f = ['job_id', 'snapshot_id', 'snapshot_digest', 'context_digest'];
  const v = closedRecord(input, f, f, 'job_ref');
  return Object.freeze({ job_id: entityId(v.job_id), snapshot_id: entityId(v.snapshot_id),
    snapshot_digest: digestValue(v.snapshot_digest), context_digest: digestValue(v.context_digest) });
}
function reference(record: JobContextRecord): JobContextRef {
  return Object.freeze({ job_id: record.job_id, snapshot_id: record.snapshot.snapshot_id,
    snapshot_digest: record.snapshot_digest, context_digest: record.context_digest });
}
function expectReference(actual: JobContextRef, expected: unknown): void {
  const e = parseJobContextRef(expected);
  if (actual.job_id !== e.job_id || actual.snapshot_id !== e.snapshot_id || actual.snapshot_digest !== e.snapshot_digest || actual.context_digest !== e.context_digest) throw new JobContextError();
}
function associations(binding: SessionBinding, snapshot: SnapshotRecord, manifest: Manifest): void {
  if (snapshot.session_key !== binding.session_key || snapshot.incarnation !== binding.incarnation || snapshot.host_epoch !== binding.host_epoch) throw new JobContextError();
  if (snapshot.manifest_id !== manifest.manifest_id || snapshot.manifest_digest !== hashPayload(manifest)) throw new JobContextError();
  const dependencies = new Set(snapshot.read_dependencies.map(hashPayload));
  if (manifest.entries.some(e => !dependencies.has(hashPayload(e.entity)))) throw new ContractError('snapshot.read_dependencies', 'manifest dependency missing');
}
/** Full persisted record validation is shape/integrity only, not a restored handle. */
export function parseJobContextRecord(input: unknown): JobContextRecord {
  const f = ['schema_version', 'job_id', 'binding', 'snapshot', 'snapshot_digest', 'manifest', 'mission', 'mission_digest', 'context_digest'];
  const v = closedRecord(input, f, f, 'job_record');
  integer(v.schema_version, 1, 1, 'job_record.schema_version');
  const binding = parseSessionBinding(v.binding), snapshot = parseSnapshotRecord(v.snapshot), manifest = parseManifest(v.manifest);
  associations(binding, snapshot, manifest);
  const mission = missionText(v.mission), snapshotDigest = hashPayload(snapshot), missionDigest = hashSource(Buffer.from(mission, 'utf8'));
  if (snapshotDigest !== digestValue(v.snapshot_digest) || missionDigest !== digestValue(v.mission_digest)) throw new JobContextError();
  const body = { schema_version: 1 as const, job_id: entityId(v.job_id), binding, snapshot, snapshot_digest: snapshotDigest,
    manifest, mission, mission_digest: missionDigest };
  if (hashPayload(body) !== digestValue(v.context_digest)) throw new JobContextError();
  const record = Object.freeze({ ...body, context_digest: v.context_digest as string });
  if (Buffer.byteLength(canonical(record), 'utf8') > MAX_JOB_RECORD_BYTES) throw new ContractError('job_record', 'byte limit exceeded');
  return record;
}
function issue(record: JobContextRecord, manifest: VerifiedManifest): JobContext {
  const result = Object.freeze({ ref: reference(record), record }) as JobContext;
  contexts.set(result, manifest);
  return result;
}
/** Projection supplies snapshot fields; IDs/scope/manifest are never model output.
 * Caller must persist the record/ref with admission before executing a generation. */
export function createJobContext(binding: unknown, fieldsInput: unknown, manifestInput: unknown, missionInput: unknown): JobContext {
  const scope = parseSessionBinding(binding), verified = assertVerifiedManifest(scope, manifestInput);
  const fields = closedRecord(fieldsInput, SNAPSHOT_INPUT_FIELDS, SNAPSHOT_INPUT_FIELDS, 'snapshot_fields');
  const snapshot = parseSnapshotRecord({ ...fields, schema_version: 1, snapshot_id: newEntityId(),
    session_key: scope.session_key, incarnation: scope.incarnation, host_epoch: scope.host_epoch,
    manifest_id: verified.manifest.manifest_id, manifest_digest: verified.digest });
  associations(scope, snapshot, verified.manifest);
  const mission = missionText(missionInput);
  const body = { schema_version: 1 as const, job_id: newEntityId(), binding: scope, snapshot,
    snapshot_digest: hashPayload(snapshot), manifest: verified.manifest, mission, mission_digest: hashSource(Buffer.from(mission, 'utf8')) };
  return issue(parseJobContextRecord({ ...body, context_digest: hashPayload(body) }), verified);
}
export function assertJobContext(binding: unknown, input: unknown, expected: unknown): JobContext {
  if (input === null || typeof input !== 'object' || !contexts.has(input)) throw new ContractError('job_context', 'expected an issued context');
  const context = input as JobContext;
  assertSessionBinding(binding, context.record.binding);
  expectReference(context.ref, expected);
  return context;
}
export function exportJobContext(binding: unknown, input: unknown, expected: unknown): JobContextRecord {
  return assertJobContext(binding, input, expected).record;
}
/** Requires externally trusted expectation AND reverified sources, never resumes a run. */
export function restoreJobContext(binding: unknown, input: unknown, manifestInput: unknown, expected: unknown): JobContext {
  const scope = parseSessionBinding(binding), record = parseJobContextRecord(input);
  assertSessionBinding(scope, record.binding);
  expectReference(reference(record), expected);
  const manifest = assertVerifiedManifest(scope, manifestInput);
  if (manifest.manifest.manifest_id !== record.snapshot.manifest_id || manifest.digest !== record.snapshot.manifest_digest) throw new JobContextError();
  return issue(record, manifest);
}
/** Callback carries the pre-captured expected ref; supplied text cannot select a job. */
export function decodeJobProposal(binding: unknown, input: unknown, expected: unknown, text: unknown, finish: unknown): JobProposal {
  const context = assertJobContext(binding, input, expected), manifest = contexts.get(context)!;
  const validated = decodeProposal(text, finish, binding, manifest, context.record.snapshot.feedback_ids);
  const result = Object.freeze({ ref: context.ref, validated }) as JobProposal;
  results.add(result);
  return result;
}
export function assertJobProposal(binding: unknown, contextInput: unknown, expected: unknown, input: unknown): JobProposal {
  const context = assertJobContext(binding, contextInput, expected);
  if (input === null || typeof input !== 'object' || !results.has(input)) throw new ContractError('job_proposal', 'expected an issued job proposal');
  const result = input as JobProposal;
  expectReference(result.ref, context.ref);
  assertProposalContext(binding, contexts.get(context)!, result.validated);
  return result;
}
