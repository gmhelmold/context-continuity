/** SPEC-15 durable events only. No network client, transport permit or View publication. */
import type { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import { canonical, parseJSON } from '../../core/src/canonical.mjs';
import { assertSessionBinding, entityId, newEntityId, hashPayload } from '../../core/src/identity.ts';
import type { SessionBinding } from '../../core/src/identity.ts';
import { assertJobContext, parseJobContextRecord, parseJobContextRef, restoreJobContext, decodeJobProposal } from '../../core/src/job-context.ts';
import type { JobContextRecord, JobContextRef, JobContext } from '../../core/src/job-context.ts';
import { verifyManifest, ManifestError } from '../../core/src/manifest.ts';
import type { VerifiedManifest } from '../../core/src/manifest.ts';
import type { Authority } from '../../core/src/roots.ts';
import { resolveConfig } from '../../core/src/config.ts';
import type { ResolvedConfiguration } from '../../core/src/config.ts';
import { boolean, choice, closedRecord, integer, ContractError } from '../../core/src/validation.ts';
import { MAX_JOB_RECORD_BYTES } from '../../core/src/snapshot.ts';
import { MAX_PROPOSAL_BYTES, parseModelProposal, ProposalError } from '../../core/src/proposal.ts';
import type { ModelProposal } from '../../core/src/proposal.ts';
import { loadRootIndex } from './root-records.ts';
import { retentionSourceReader } from './source-records.ts';
import { StorageError } from './errors.ts';
import type { SessionRecord } from './session-store.ts';

const MAX = Number.MAX_SAFE_INTEGER;
const STATUSES = ['queued', 'running', 'ready', 'published', 'rejected', 'failed', 'cancelled'] as const;
const ATTEMPT_STATES = ['reserved', 'dispatched', 'completed', 'failed', 'cancelled', 'unknown'] as const;
const ACTIVE = new Set<string>(['queued', 'running', 'ready']);
export type AttemptRef = Readonly<{ job_id: string; attempt_id: string; run_id: string; attempt_no: number }>;
export type StoredAttempt = Readonly<{
  ref: AttemptRef; state: typeof ATTEMPT_STATES[number]; input_reserved: number; output_reserved: number;
  local_state: 'reserved' | 'running' | 'stopped' | 'quarantine'; local_stopped: boolean; remote_state: 'unknown' | 'confirmed';
}>;
type Retry = Readonly<{ kind: 'retry' | 'repair'; not_before_ms: number }> | null;
export type StoredJob = Readonly<{
  ref: JobContextRef; context: JobContextRecord; configuration: ResolvedConfiguration;
  status: typeof STATUSES[number]; deadline_at: string; error_code: string | null;
  proposal: ModelProposal | null; attempts: readonly StoredAttempt[]; retry: Retry; updated_at: string;
}>;
export type AttemptBudget = Readonly<{ input_tokens: number; output_tokens: number }>;
export type AttemptResult =
  | Readonly<{ kind: 'response'; text: string; finish: 'complete' | 'length' | 'tool_call' | 'cancelled' | 'error'; local_stopped: boolean; parent_input_tokens: number; candidate_input_tokens: number }>
  | Readonly<{ kind: 'http_error'; status: number; retry_after_ms: number | null; local_stopped: boolean }>
  | Readonly<{ kind: 'aborted'; local_stopped: boolean }>;
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const count = (v: unknown): number => integer(v, 0, MAX, 'job.counter');
const date = (ms: number): string => new Date(ms).toISOString();
function utc(input: unknown): string {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input) ||
      !Number.isFinite(Date.parse(input)) || date(Date.parse(input)) !== input) throw new StorageError('E_STORAGE', 'invalid job timestamp');
  return input;
}
function json(input: unknown, limit = MAX_JOB_RECORD_BYTES + 65536): unknown {
  if (typeof input !== 'string' || Buffer.byteLength(input) > limit) throw new StorageError('E_STORAGE', 'job record size invalid');
  return parseJSON(input);
}
function config(input: unknown): ResolvedConfiguration {
  const r = closedRecord(input, ['settings', 'limits'], ['settings', 'limits'], 'job.configuration');
  const parsed = resolveConfig(r.settings, r.limits);
  if (!equal(parsed, input)) throw new StorageError('E_STORAGE', 'incomplete stored configuration');
  return parsed;
}
export function parseAttemptRef(input: unknown): AttemptRef {
  const fields = ['job_id', 'attempt_id', 'run_id', 'attempt_no'];
  const r = closedRecord(input, fields, fields, 'attempt_ref');
  return Object.freeze({ job_id: entityId(r.job_id), attempt_id: entityId(r.attempt_id), run_id: entityId(r.run_id),
    attempt_no: integer(r.attempt_no, 1, 2, 'attempt.number') });
}
export function parseAttemptBudget(input: unknown): AttemptBudget {
  const fields = ['input_tokens', 'output_tokens'], r = closedRecord(input, fields, fields, 'attempt_budget');
  return Object.freeze({ input_tokens: integer(r.input_tokens, 1, MAX, 'attempt.input'), output_tokens: count(r.output_tokens) });
}
export function parseAttemptResult(input: unknown): AttemptResult {
  const all = ['kind', 'local_stopped', 'text', 'finish', 'parent_input_tokens', 'candidate_input_tokens', 'status', 'retry_after_ms'];
  const r = closedRecord(input, all, ['kind', 'local_stopped'], 'attempt_result');
  const kind = choice(r.kind, ['response', 'http_error', 'aborted'] as const, 'result.kind');
  const local_stopped = boolean(r.local_stopped, 'result.local_stopped');
  if (kind === 'aborted') {
    closedRecord(input, ['kind', 'local_stopped'], ['kind', 'local_stopped'], 'abort');
    return Object.freeze({ kind, local_stopped });
  }
  if (kind === 'http_error') {
    const fields = ['kind', 'local_stopped', 'status', 'retry_after_ms']; closedRecord(input, fields, fields, 'http_error');
    return Object.freeze({ kind, local_stopped, status: integer(r.status, 400, 599, 'http.status'),
      retry_after_ms: r.retry_after_ms === null ? null : integer(r.retry_after_ms, 0, 60000, 'http.retry_after') });
  }
  const fields = ['kind', 'local_stopped', 'text', 'finish', 'parent_input_tokens', 'candidate_input_tokens'];
  closedRecord(input, fields, fields, 'response');
  if (typeof r.text !== 'string' || !r.text.isWellFormed() || Buffer.byteLength(r.text) > MAX_PROPOSAL_BYTES) {
    throw new StorageError('E_BUDGET', 'response text exceeds storage boundary');
  }
  return Object.freeze({ kind, local_stopped, text: r.text,
    finish: choice(r.finish, ['complete', 'length', 'tool_call', 'cancelled', 'error'] as const, 'response.finish'),
    parent_input_tokens: integer(r.parent_input_tokens, 1, MAX, 'response.before'), candidate_input_tokens: count(r.candidate_input_tokens) });
}
function progress(input: unknown): Retry {
  const r = closedRecord(json(input, 1024), ['schema_version', 'retry'], ['schema_version', 'retry'], 'job.progress');
  integer(r.schema_version, 1, 1, 'job.progress.version');
  if (r.retry === null) return null;
  const p = closedRecord(r.retry, ['kind', 'not_before_ms'], ['kind', 'not_before_ms'], 'job.retry');
  return Object.freeze({ kind: choice(p.kind, ['retry', 'repair'] as const, 'job.retry.kind'), not_before_ms: count(p.not_before_ms) });
}
function attempts(db: DatabaseSync, b: SessionBinding, job: string): readonly StoredAttempt[] {
  const rows = db.prepare(`SELECT a.*,r.run_id,r.state AS local_state,r.local_stopped,r.remote_state
    FROM attempts a JOIN aux_runs r ON r.session_key=a.session_key AND r.job_id=a.job_id AND r.attempt_no=a.attempt_no
    WHERE a.session_key=? AND a.job_id=? ORDER BY a.attempt_no LIMIT 3`).all(b.session_key, job);
  if (rows.length > 2) throw new StorageError('E_STORAGE', 'attempt limit inconsistent');
  const runCount = db.prepare('SELECT count(*) AS n FROM aux_runs WHERE session_key=? AND job_id=?').get(b.session_key, job)!.n;
  if (runCount !== rows.length) throw new StorageError('E_STORAGE', 'run and attempt records disagree');
  return Object.freeze(rows.map((r, i) => {
    const ref = parseAttemptRef({ job_id: job, attempt_id: r.attempt_id, run_id: r.run_id, attempt_no: r.attempt_no });
    if (ref.attempt_no !== i + 1) throw new StorageError('E_STORAGE', 'attempt sequence inconsistent');
    const state = choice(r.state, ATTEMPT_STATES, 'attempt.state');
    const local_state = choice(r.local_state, ['reserved', 'running', 'stopped', 'quarantine'] as const, 'run.state');
    const local_stopped = integer(r.local_stopped, 0, 1, 'run.stopped') === 1;
    if ((local_state === 'stopped') !== local_stopped || ((state === 'reserved') !== (local_state === 'reserved')) ||
        ((state === 'dispatched') !== (local_state === 'running'))) throw new StorageError('E_STORAGE', 'attempt lifecycle inconsistent');
    return Object.freeze({ ref, state, local_state, local_stopped,
      remote_state: choice(r.remote_state, ['unknown', 'confirmed'] as const, 'run.remote'),
      input_reserved: count(r.input_reserved), output_reserved: count(r.output_reserved) });
  }));
}
/** Checksums detect inconsistent records, not hostile replacement of the whole DB.
 * Source-independent diagnostics must not fabricate source-verified handles. */
function storedProposal(input: unknown, context: JobContextRecord, ref: JobContextRef): ModelProposal {
  try {
    const fields = ['schema_version', 'value', 'digest'];
    const r = closedRecord(json(input, MAX_PROPOSAL_BYTES + 1024), fields, fields, 'stored_proposal');
    integer(r.schema_version, 1, 1, 'stored_proposal.version');
    if (r.digest !== hashPayload({ ref, value: r.value })) throw new Error('checksum');
    return parseModelProposal(canonical(r.value), context.manifest, context.snapshot.feedback_ids);
  } catch { throw new StorageError('E_STORAGE', 'stored proposal integrity invalid'); }
}
export function loadJob(db: DatabaseSync, binding: SessionBinding, expected: JobContextRef): StoredJob | null {
  const r = db.prepare('SELECT * FROM jobs WHERE session_key=? AND job_id=?').get(binding.session_key, expected.job_id);
  if (!r) return null;
  const fields = ['schema_version', 'expected', 'context', 'configuration'];
  const envelope = closedRecord(json(r.snapshot_json), fields, fields, 'stored_job');
  integer(envelope.schema_version, 1, 1, 'stored_job.version');
  const ref = parseJobContextRef(envelope.expected), context = parseJobContextRecord(envelope.context);
  const actual = { job_id: context.job_id, snapshot_id: context.snapshot.snapshot_id,
    snapshot_digest: context.snapshot_digest, context_digest: context.context_digest };
  assertSessionBinding(binding, context.binding);
  if (!equal(ref, expected) || !equal(ref, actual) || r.job_id !== ref.job_id || r.incarnation !== binding.incarnation ||
      r.owner_fence !== context.snapshot.owner_fence || !equal(json(r.manifest_json, 262144), context.manifest)) {
    throw new StorageError('E_CONFLICT', 'stored job association mismatch');
  }
  const configuration = config(envelope.configuration), records = attempts(db, binding, ref.job_id);
  if (r.attempts !== records.length || records.length > configuration.settings.maximum_attempts) throw new StorageError('E_STORAGE', 'attempt count mismatch');
  const deadline_at = utc(r.deadline_at), updated_at = utc(r.updated_at), created = utc(r.created_at);
  if (created !== context.snapshot.created_at || Date.parse(deadline_at) !== Date.parse(created) + configuration.settings.job_timeout_ms) {
    throw new StorageError('E_STORAGE', 'job deadline inconsistent');
  }
  const status = choice(r.status, STATUSES, 'job.status'), retry = progress(r.usage_json);
  if (r.error_code !== null && (typeof r.error_code !== 'string' || !/^E_[A-Z_]{1,32}$/.test(r.error_code))) throw new StorageError('E_STORAGE', 'job error invalid');
  if ((status === 'queued' && records.length !== 0) || (retry !== null && (status !== 'running' || records.at(-1)?.state !== 'failed'))) {
    throw new StorageError('E_STORAGE', 'job progress inconsistent');
  }
  const proposal = r.proposal_json === null ? null : storedProposal(r.proposal_json, context, ref);
  const last = records.at(-1);
  if ((status === 'ready' || status === 'published') && (!proposal || proposal.action !== 'replace' ||
      last?.state !== 'completed' || !last.local_stopped || last.remote_state !== 'confirmed' || r.error_code !== null || retry !== null)) {
    throw new StorageError('E_STORAGE', 'ready job has no completed result');
  }
  if ((status === 'queued' && (proposal !== null || r.error_code !== null)) ||
      (status === 'running' && (!last || proposal !== null ||
        !(['reserved', 'dispatched'].includes(last.state) || (last.state === 'failed' && last.local_stopped && retry !== null)))) ||
      (!ACTIVE.has(status) && records.some(a => a.state === 'reserved' || a.state === 'dispatched')) ||
      (proposal !== null && last?.state !== 'completed')) {
    throw new StorageError('E_STORAGE', 'job and attempt states disagree');
  }
  return Object.freeze({ ref, context, configuration, status, deadline_at, error_code: r.error_code as string | null,
    proposal, attempts: records, retry, updated_at });
}
export function requireJob(db: DatabaseSync, binding: SessionBinding, ref: JobContextRef): StoredJob {
  const job = loadJob(db, binding, ref);
  if (!job) throw new StorageError('E_CONFLICT', 'job not admitted');
  return job;
}
export function assertJobCurrent(job: StoredJob, session: SessionRecord, now: number): void {
  const s = job.context.snapshot;
  if (s.owner_fence !== session.owner_fence || s.view_revision !== session.view_revision || s.policy_revision !== session.policy_revision ||
      !equal(job.configuration, session.config)) throw new StorageError('E_CONFLICT', 'job control changed');
  if (Date.parse(job.deadline_at) <= now) throw new StorageError('E_CONFLICT', 'job deadline expired');
  if (session.paused || session.dispatch_blocked) throw new StorageError('E_CONFLICT', 'session maintenance paused');
}
/** Rechecks only required bytes, using immutable references in the same transaction. */
function verifyJobSources(db: DatabaseSync, b: SessionBinding, record: JobContextRecord): VerifiedManifest {
  try { return verifyRetainedJobSources(db, b, record); }
  catch (error) {
    // A source/schema failure is never a schema error from the model response.
    if (error instanceof ContractError || error instanceof ManifestError) {
      throw new StorageError('E_SOURCE', 'retained job source verification failed');
    }
    throw error;
  }
}
function verifyRetainedJobSources(db: DatabaseSync, b: SessionBinding, record: JobContextRecord): VerifiedManifest {
  const s = record.snapshot;
  if (s.feedback_ids.length || s.read_dependencies.some(e => e.kind !== 'source') || record.manifest.entries.some(e => e.entity.kind !== 'source') ||
      !equal(s.logical_coverage, s.root_coverage.map(r => r.unit_id))) throw new StorageError('E_CAPABILITY', 'job requires unsupported durable entities');
  const index = loadRootIndex(db, b), current = new Map(index.entries.map(e => [e.unit.unit_id, e.unit]));
  const dependencies = new Set(s.read_dependencies.map(e => canonical(e.ref)));
  for (const ref of s.root_coverage) {
    const root = current.get(ref.unit_id);
    if (!root || !equal(root.root_coverage[0], ref) || root.protected || !root.completed) throw new StorageError('E_SOURCE', 'job roots changed or protected');
    if (root.source_refs.some(source => !dependencies.has(canonical(source)))) throw new StorageError('E_SOURCE', 'covered source missing from dependencies');
  }
  const authorities = new Map<string, Set<Authority>>();
  for (const { unit } of index.entries) for (const ref of unit.source_refs) {
    const key = canonical(ref);
    if (!dependencies.has(key)) continue;
    const owners = authorities.get(key) ?? new Set<Authority>(); owners.add(unit.authority); authorities.set(key, owners);
  }
  const read = retentionSourceReader(db, b);
  for (const dependency of s.read_dependencies) if (dependency.kind === 'source') read(dependency.ref);
  return verifyManifest(record.manifest, b, entity => {
    if (entity.kind !== 'source') return null;
    const owners = authorities.get(canonical(entity.ref));
    if (!owners || owners.size !== 1) return null;
    return { binding: b, entity, authority: [...owners][0]!, bytes: read(entity.ref).bytes };
  });
}
export function admitJob(db: DatabaseSync, session: SessionRecord, context: JobContext, expected: JobContextRef, now: number): StoredJob {
  const b = session.binding;
  const record = assertJobContext(b, context, expected).record;
  const existing = loadJob(db, b, expected);
  if (existing) return existing; // Exact replay is diagnostic, not a fresh admission.
  if (db.prepare("SELECT 1 FROM jobs WHERE session_key=? AND status IN ('queued','running','ready')").get(b.session_key) ||
      db.prepare("SELECT 1 FROM aux_runs WHERE session_key=? AND state<>'stopped'").get(b.session_key)) {
    throw new StorageError('E_CONFLICT', 'session already has active or quarantined work');
  }
  const deadline = Date.parse(record.snapshot.created_at) + session.config.settings.job_timeout_ms;
  const preview = { context: record, configuration: session.config, deadline_at: date(deadline) } as StoredJob;
  assertJobCurrent(preview, session, now);
  if (Date.parse(record.snapshot.created_at) > now) throw new StorageError('E_CONFLICT', 'snapshot is in the future');
  verifyJobSources(db, b, record);
  const envelope = { schema_version: 1, expected, context: record, configuration: session.config };
  db.prepare(`INSERT INTO jobs(job_id,session_key,incarnation,status,snapshot_json,manifest_json,owner_fence,deadline_at,usage_json,created_at,updated_at)
    VALUES (?,?,?,'queued',?,?,?,?,?,?,?)`).run(expected.job_id, b.session_key, b.incarnation, canonical(envelope), canonical(record.manifest),
      record.snapshot.owner_fence, date(deadline), canonical({ schema_version: 1, retry: null }), record.snapshot.created_at, date(now));
  return requireJob(db, b, expected);
}
function selectedAttempt(job: StoredJob, ref: AttemptRef): StoredAttempt {
  const result = job.attempts[ref.attempt_no - 1];
  if (!result || !equal(result.ref, ref) || ref.job_id !== job.ref.job_id) throw new StorageError('E_CONFLICT', 'attempt association mismatch');
  return result;
}
function updateJob(db: DatabaseSync, b: SessionBinding, job: StoredJob, status: StoredJob['status'], error: string | null,
  retry: Retry, proposal: ModelProposal | null, now: number): void {
  const changed = db.prepare(`UPDATE jobs SET status=?,error_code=?,usage_json=?,proposal_json=?,updated_at=?
    WHERE session_key=? AND job_id=? AND status=?`).run(status, error, canonical({ schema_version: 1, retry }),
      proposal === null ? null : canonical({ schema_version: 1, value: proposal, digest: hashPayload({ ref: job.ref, value: proposal }) }), date(now), b.session_key, job.ref.job_id, job.status);
  if (changed.changes !== 1) throw new StorageError('E_CONFLICT', 'job state changed');
}
function updateAttempt(db: DatabaseSync, b: SessionBinding, a: StoredAttempt, state: StoredAttempt['state'],
  local: StoredAttempt['local_state'], remote: StoredAttempt['remote_state']): void {
  const first = db.prepare('UPDATE attempts SET state=? WHERE session_key=? AND attempt_id=? AND state=?')
    .run(state, b.session_key, a.ref.attempt_id, a.state);
  const second = db.prepare('UPDATE aux_runs SET state=?,local_stopped=?,remote_state=? WHERE session_key=? AND run_id=? AND state=?')
    .run(local, local === 'stopped' ? 1 : 0, remote, b.session_key, a.ref.run_id, a.local_state);
  if (first.changes !== 1 || second.changes !== 1) throw new StorageError('E_CONFLICT', 'attempt state changed');
}
function reserveCounters(db: DatabaseSync, b: SessionBinding, cfg: ResolvedConfiguration, amount: AttemptBudget): void {
  const stored = json(db.prepare('SELECT counters_json FROM sessions WHERE session_key=?').get(b.session_key)!.counters_json, 16384);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new StorageError('E_STORAGE', 'session counters invalid');
  const counters = stored as Record<string, unknown>;
  const fields = ['calls', 'input_tokens', 'output_tokens'];
  const old = Object.hasOwn(counters, 'job_budget') ? closedRecord(counters.job_budget, fields, fields, 'job_budget')
    : { calls: 0, input_tokens: 0, output_tokens: 0 };
  const calls = count(count(old.calls) + 1), input = count(count(old.input_tokens) + amount.input_tokens), output = count(count(old.output_tokens) + amount.output_tokens);
  if (calls > cfg.settings.max_calls_per_session || input > cfg.settings.max_input_per_session) throw new StorageError('E_BUDGET', 'session job quota exhausted');
  db.prepare('UPDATE sessions SET counters_json=? WHERE session_key=?').run(
    canonical({ ...counters, job_budget: { calls, input_tokens: input, output_tokens: output } }), b.session_key);
}
export function reserveJobAttempt(db: DatabaseSync, session: SessionRecord, expected: JobContextRef, amount: AttemptBudget, now: number): AttemptRef {
  const b = session.binding, job = requireJob(db, b, expected);
  assertJobCurrent(job, session, now);
  const last = job.attempts.at(-1);
  if (job.status !== 'queued' && !(job.status === 'running' && job.retry && last?.state === 'failed' && last.local_stopped && job.retry.not_before_ms <= now)) {
    throw new StorageError('E_CONFLICT', 'job cannot reserve another attempt');
  }
  const cfg = job.configuration, limit = Math.min(cfg.limits.context_window - cfg.limits.output_reserve,
    cfg.limits.input_limit ?? MAX, cfg.settings.healthy_input_ceiling ?? MAX);
  if (amount.input_tokens > limit || amount.output_tokens !== cfg.limits.output_reserve || job.attempts.length >= cfg.settings.maximum_attempts) {
    throw new StorageError('E_BUDGET', 'attempt exceeds frozen budget');
  }
  if (db.prepare("SELECT 1 FROM aux_runs WHERE session_key=? AND state<>'stopped'").get(b.session_key)) throw new StorageError('E_CONFLICT', 'local run has not stopped');
  verifyJobSources(db, b, job.context);
  reserveCounters(db, b, cfg, amount);
  const ref = Object.freeze({ job_id: expected.job_id, attempt_id: newEntityId(), run_id: newEntityId(), attempt_no: job.attempts.length + 1 });
  db.prepare(`INSERT INTO aux_runs(run_id,session_key,job_id,attempt_no,state,remote_state,local_stopped)
    VALUES (?,?,?,?,'reserved','unknown',0)`).run(ref.run_id, b.session_key, ref.job_id, ref.attempt_no);
  db.prepare(`INSERT INTO attempts(attempt_id,session_key,job_id,attempt_no,state,input_reserved,output_reserved)
    VALUES (?,?,?,?,'reserved',?,?)`).run(ref.attempt_id, b.session_key, ref.job_id, ref.attempt_no, amount.input_tokens, amount.output_tokens);
  db.prepare('UPDATE jobs SET attempts=? WHERE session_key=? AND job_id=?').run(ref.attempt_no, b.session_key, ref.job_id);
  updateJob(db, b, job, 'running', null, null, null, now);
  return ref;
}
export function markJobAttemptDispatched(db: DatabaseSync, session: SessionRecord, expected: JobContextRef, ref: AttemptRef, now: number): StoredJob {
  const b = session.binding, job = requireJob(db, b, expected), a = selectedAttempt(job, ref);
  assertJobCurrent(job, session, now);
  if (job.status !== 'running' || a.state !== 'reserved' || a !== job.attempts.at(-1)) throw new StorageError('E_CONFLICT', 'dispatch intent already consumed or cancelled');
  verifyJobSources(db, b, job.context);
  updateAttempt(db, b, a, 'dispatched', 'running', 'unknown');
  updateJob(db, b, job, 'running', null, null, null, now);
  return requireJob(db, b, expected);
}
export function recordJobAttemptResult(db: DatabaseSync, session: SessionRecord, expected: JobContextRef, ref: AttemptRef, result: AttemptResult, now: number): StoredJob {
  const b = session.binding, job = requireJob(db, b, expected), a = selectedAttempt(job, ref);
  if (!ACTIVE.has(job.status)) return job; // Callback cannot revive or rewrite a terminal generation.
  assertJobCurrent(job, session, now);
  if (job.status !== 'running' || a.state !== 'dispatched' || a !== job.attempts.at(-1)) throw new StorageError('E_CONFLICT', 'result is not for the current dispatched attempt');
  let status: StoredJob['status'] = 'failed', error: string | null = 'E_PROTOCOL', retry: Retry = null, proposal: ModelProposal | null = null;
  let attemptState: StoredAttempt['state'] = 'failed', remote: StoredAttempt['remote_state'] = 'unknown';
  const next = (kind: 'retry' | 'repair', delay: number): void => {
    const notBefore = now + delay;
    if (a.ref.attempt_no < job.configuration.settings.maximum_attempts && notBefore < Date.parse(job.deadline_at)) {
      status = 'running'; retry = Object.freeze({ kind, not_before_ms: notBefore });
    }
  };
  if (!result.local_stopped || result.kind === 'aborted') {
    attemptState = 'unknown';
  } else if (result.kind === 'http_error') {
    if (result.status === 429 || result.status >= 500) { error = 'E_TRANSIENT'; next('retry', result.retry_after_ms ?? 2000); }
  } else {
    // Persistent-data errors are handled before response parsing. Only decoding
    // errors below may consume a repair opportunity.
    let context: JobContext | null = null;
    try {
      const manifest = verifyJobSources(db, b, job.context);
      context = restoreJobContext(b, job.context, manifest, expected);
    } catch (cause) {
      if (!(cause instanceof StorageError) || !['E_SOURCE', 'E_CAPABILITY', 'E_BUDGET'].includes(cause.code)) throw cause;
      error = cause.code;
      status = cause.code === 'E_BUDGET' ? 'failed' : 'rejected';
    }
    if (context !== null) try {
      // The transport finisher wins over blank text (e.g. an empty tool call).
      if (result.finish === 'complete' && !result.text.trim().length) throw new ProposalError('E_NO_GAIN');
      proposal = decodeJobProposal(b, context, expected, result.text, result.finish).validated.proposal;
      remote = 'confirmed'; attemptState = 'completed';
      if (result.parent_input_tokens > a.input_reserved || result.candidate_input_tokens > a.input_reserved) throw new StorageError('E_BUDGET', 'gain inputs exceed admitted envelope');
      const minimum = Math.max(job.configuration.settings.minimum_gain, Math.ceil(job.configuration.settings.minimum_gain_ratio * result.parent_input_tokens));
      if (proposal.action === 'noop' || result.parent_input_tokens - result.candidate_input_tokens < minimum) { status = 'rejected'; error = 'E_NO_GAIN'; }
      else { status = 'ready'; error = null; }
    } catch (cause) {
      const code = (cause as { code?: unknown } | null)?.code;
      if (typeof code !== 'string' || !['E_SCHEMA', 'E_NO_GAIN', 'E_SOURCE', 'E_BUDGET', 'E_CAPABILITY', 'E_TOOL', 'E_PROTOCOL'].includes(code)) throw cause;
      error = code; proposal = null; attemptState = 'failed';
      if (code === 'E_SCHEMA') next('repair', 0);
      else if (['E_NO_GAIN', 'E_SOURCE', 'E_CAPABILITY'].includes(code)) status = 'rejected';
    }
  }
  updateAttempt(db, b, a, attemptState, result.local_stopped ? 'stopped' : 'quarantine', remote);
  updateJob(db, b, job, status, error, retry, proposal, now);
  return requireJob(db, b, expected);
}
export function cancelJob(db: DatabaseSync, session: SessionRecord, expected: JobContextRef, now: number): StoredJob {
  const b = session.binding, job = requireJob(db, b, expected);
  if (!ACTIVE.has(job.status)) return job;
  for (const a of job.attempts) {
    if (a.state === 'reserved') updateAttempt(db, b, a, 'cancelled', 'stopped', 'unknown');
    else if (a.state === 'dispatched') updateAttempt(db, b, a, 'unknown', 'quarantine', 'unknown');
  }
  updateJob(db, b, job, 'cancelled', 'E_CANCELLED', null, job.proposal, now);
  return requireJob(db, b, expected);
}
/** Only the same fenced supervisor may report local stop; not remote completion. */
export function confirmJobAttemptStopped(db: DatabaseSync, session: SessionRecord, expected: JobContextRef, ref: AttemptRef): StoredJob {
  const b = session.binding, job = requireJob(db, b, expected), a = selectedAttempt(job, ref);
  if (job.context.snapshot.owner_fence !== session.owner_fence) throw new StorageError('E_OWNER', 'old run needs independent liveness reconciliation');
  if (a.local_stopped) return job;
  if (ACTIVE.has(job.status) || a.local_state !== 'quarantine') throw new StorageError('E_CONFLICT', 'run is not awaiting local stop');
  updateAttempt(db, b, a, a.state, 'stopped', a.remote_state);
  return requireJob(db, b, expected);
}
export function recoverJobs(db: DatabaseSync, session: SessionRecord, now: number): readonly StoredJob[] {
  const b = session.binding;
  const rows = db.prepare(`SELECT snapshot_json FROM jobs WHERE session_key=? AND
    (status IN ('queued','running','ready') OR job_id IN (SELECT job_id FROM aux_runs WHERE session_key=? AND state<>'stopped')) LIMIT 3`)
    .all(b.session_key, b.session_key);
  if (rows.length > 2) throw new StorageError('E_STORAGE', 'active job invariants violated');
  const recovered: StoredJob[] = [];
  for (const row of rows) {
    const envelope = json(row.snapshot_json) as Record<string, unknown>;
    const ref = parseJobContextRef(envelope.expected); // Trusted persisted control, not derived from context.
    const job = requireJob(db, b, ref), oldOwner = job.context.snapshot.owner_fence !== session.owner_fence;
    const expired = Date.parse(job.deadline_at) <= now;
    if (ACTIVE.has(job.status) && (oldOwner || expired)) {
      for (const a of job.attempts) {
        if (a.state === 'reserved') updateAttempt(db, b, a, 'cancelled', 'stopped', 'unknown');
        else if (a.state === 'dispatched') updateAttempt(db, b, a, 'unknown', 'quarantine', 'unknown');
      }
      updateJob(db, b, job, job.status === 'ready' ? 'cancelled' : 'failed', oldOwner ? 'E_OWNER' : 'E_TIMEOUT', null, job.proposal, now);
    }
    recovered.push(requireJob(db, b, ref));
  }
  return Object.freeze(recovered);
}
export function jobIsActive(job: StoredJob): boolean { return ACTIVE.has(job.status); }
