/** Durable session and job events. No blobs, inference or View publication API. */
import type { DatabaseSync } from 'node:sqlite';
import { parseJSON } from '../../core/src/canonical.mjs';
import { canonical } from '../../core/src/canonical.mjs';
import { parseSessionBinding, createSessionBinding, digestValue, entityId, newEntityId } from '../../core/src/identity.ts';
import type { SessionBinding } from '../../core/src/identity.ts';
import { resolveConfig } from '../../core/src/config.ts';
import type { ResolvedConfiguration } from '../../core/src/config.ts';
import { deriveTriggerBudget, evaluateTrigger } from '../../core/src/scheduler-budget.ts';
import { boolean, choice, closedRecord, ContractError, integer } from '../../core/src/validation.ts';
import { connectSQLite } from './sqlite-database.ts';
import type { WorkspaceIdentity } from './sqlite-database.ts';
import { StorageError, storageFailure } from './errors.ts';
import { loadRootCatalog, loadRoot, prepareRootBatch, retainRootBatch } from './root-records.ts';
import { loadSource } from './source-records.ts';
import type { RetainedSource } from './source-records.ts';
import { parseSourceRef, parseRootRef } from '../../core/src/roots.ts';
import type { RootCatalog, RootUnit } from '../../core/src/roots.ts';
import { parseJobContextRef, assertJobContext } from '../../core/src/job-context.ts';
import type { JobContextRef } from '../../core/src/job-context.ts';
import * as jobs from './job-records.ts';
import type { StoredJob, AttemptRef } from './job-records.ts';
import { assertAttemptOwner, bindAttemptOwner, loadAttemptOwnership, retainObservedCompletion, reconcileObservedCompletions } from './attempt-owner.ts';
import type { AttemptOwnership } from './attempt-owner.ts';
import { assertWorkspaceHold } from './workspace-coordinator.ts';
export const OWNER_LEASE_MS = 30_000;
const MAX_TIME = 8_640_000_000_000_000 - OWNER_LEASE_MS;
export type SessionRecord = Readonly<{
  binding: SessionBinding; config: ResolvedConfiguration; view_revision: number; policy_revision: number;
  owner_fence: number; owner_id: string | null; lease_until_ms: number | null;
  mode: 'complete' | 'assisted' | 'unsupported'; paused: boolean; dispatch_blocked: boolean;
}>;
export type OwnerLease = Readonly<{ binding: SessionBinding; owner_id: string; owner_fence: number; lease_until_ms: number }>;
export type SchedulerState = Readonly<{
  binding: SessionBinding; armed: boolean;
  last_attempt: Readonly<{ host_epoch: number; coverage_digest: string; policy_revision: number; config_digest: string }> | null;
  low_water: Readonly<{ host_epoch: number; policy_revision: number; config_digest: string }> | null;
  last_observed_eligible_tokens: number | null; last_observed_at_ms: number | null;
}>;
export type PrimaryObservation = Readonly<{
  host_epoch: number; coverage_digest: string; policy_revision: number; config_digest: string;
  eligible_tokens: number; observed_at_ms: number; below_rearm_threshold: boolean;
}>;
export type PrimaryRearmObservation = Readonly<{
  host_epoch: number; coverage_digest: string; policy_revision: number; config_digest: string;
  configuration: ResolvedConfiguration; eligible_tokens: number; observed_at_ms: number;
}>;
export type PrimaryRearmResult = Readonly<{ state: SchedulerState; reason: 'low_water' | 'growth' | null }>;
export type PrimarySchedulerAdmission = Readonly<{ job: StoredJob; attempt: AttemptRef; state: SchedulerState }>;
function configuration(input: unknown): ResolvedConfiguration {
  const v = closedRecord(input, ['settings', 'limits'], ['settings', 'limits'], 'configuration');
  const result = resolveConfig(v.settings, v.limits);
  if (canonical(v) !== canonical(result)) throw new ContractError('configuration', 'expected complete resolved configuration');
  return result;
}
function counter(input: unknown): number { return integer(input, 0, Number.MAX_SAFE_INTEGER, 'stored.counter'); }
function timeValue(input: unknown): number { return integer(input, 0, MAX_TIME, 'clock'); }
function leaseValue(input: unknown): OwnerLease {
  const fields = ['binding', 'owner_id', 'owner_fence', 'lease_until_ms'];
  const v = closedRecord(input, fields, fields, 'lease');
  return Object.freeze({ binding: parseSessionBinding(v.binding), owner_id: entityId(v.owner_id),
    owner_fence: integer(v.owner_fence, 1, Number.MAX_SAFE_INTEGER, 'lease.fence'), lease_until_ms: integer(v.lease_until_ms, 1, MAX_TIME + OWNER_LEASE_MS, 'lease.until') });
}
function observation(input: unknown): PrimaryObservation {
  const fields = ['host_epoch', 'coverage_digest', 'policy_revision', 'config_digest', 'eligible_tokens', 'observed_at_ms', 'below_rearm_threshold'];
  const v = closedRecord(input, fields, fields, 'primary_observation');
  return Object.freeze({ host_epoch: integer(v.host_epoch, 0, Number.MAX_SAFE_INTEGER, 'observation.host_epoch'),
    coverage_digest: digestValue(v.coverage_digest, 'observation.coverage_digest'), policy_revision: integer(v.policy_revision, 0, Number.MAX_SAFE_INTEGER, 'observation.policy_revision'),
    config_digest: digestValue(v.config_digest, 'observation.config_digest'), eligible_tokens: integer(v.eligible_tokens, 0, Number.MAX_SAFE_INTEGER, 'observation.eligible_tokens'),
    observed_at_ms: integer(v.observed_at_ms, 0, MAX_TIME, 'observation.observed_at_ms'), below_rearm_threshold: boolean(v.below_rearm_threshold, 'observation.below_rearm_threshold') });
}
function rearmObservation(input: unknown): PrimaryRearmObservation {
  const fields = ['host_epoch', 'coverage_digest', 'policy_revision', 'config_digest', 'configuration', 'eligible_tokens', 'observed_at_ms'];
  const v = closedRecord(input, fields, fields, 'primary_rearm_observation');
  return Object.freeze({ host_epoch: integer(v.host_epoch, 0, Number.MAX_SAFE_INTEGER, 'observation.host_epoch'),
    coverage_digest: digestValue(v.coverage_digest, 'observation.coverage_digest'), policy_revision: integer(v.policy_revision, 0, Number.MAX_SAFE_INTEGER, 'observation.policy_revision'),
    config_digest: digestValue(v.config_digest, 'observation.config_digest'), configuration: configuration(v.configuration),
    eligible_tokens: integer(v.eligible_tokens, 0, Number.MAX_SAFE_INTEGER, 'observation.eligible_tokens'),
    observed_at_ms: integer(v.observed_at_ms, 0, MAX_TIME, 'observation.observed_at_ms') });
}
function schedulerAdmission(input: unknown): Readonly<{
  context: unknown; expected: JobContextRef; observation: PrimaryRearmObservation;
  selected_interval_tokens: number; attempt_budget: jobs.AttemptBudget; owner_hold: unknown;
}> {
  const fields = ['context', 'expected', 'observation', 'selected_interval_tokens', 'attempt_budget', 'owner_hold'];
  const v = closedRecord(input, fields, fields, 'primary_scheduler_admission');
  return Object.freeze({ context: v.context, expected: parseJobContextRef(v.expected), observation: rearmObservation(v.observation),
    selected_interval_tokens: integer(v.selected_interval_tokens, 0, Number.MAX_SAFE_INTEGER, 'selected_interval_tokens'),
    attempt_budget: jobs.parseAttemptBudget(v.attempt_budget), owner_hold: v.owner_hold });
}
export class SqliteSessionStore {
  readonly owner_id: string;
  readonly workspace: WorkspaceIdentity;
  #db: DatabaseSync;
  #guard: () => void;
  #clock: () => number;
  #closed = false;
  private constructor(directory: unknown, workspace: unknown, create: boolean, clock: () => number) {
    if (typeof clock !== 'function') throw new StorageError('E_STORAGE', 'clock function required');
    const handle = connectSQLite(directory, workspace, create);
    this.#db = handle.db; this.workspace = handle.identity; this.#guard = handle.guard; this.#clock = clock;
    this.owner_id = newEntityId();
    Object.freeze(this);
  }
  /** Connection settings, not a claim about hardware or host certification. */
  diagnostics(): Readonly<{ sqlite_version: string; journal_mode: string; synchronous: number; foreign_keys: number; busy_timeout: number }> {
    return this.#transaction(false, () => {
      const scalar = (name: string): unknown => Object.values(this.#db.prepare(`PRAGMA ${name}`).get()!)[0];
      return Object.freeze({ sqlite_version: String(this.#db.prepare('SELECT sqlite_version() AS value').get()!.value),
        journal_mode: String(scalar('journal_mode')), synchronous: counter(scalar('synchronous')),
        foreign_keys: counter(scalar('foreign_keys')), busy_timeout: counter(scalar('busy_timeout')) });
    });
  }
  /** Directory must already be owned/private. Creation is explicitly exclusive. */
  static create(directory: unknown, workspace: unknown, clock: () => number = Date.now): SqliteSessionStore {
    return new SqliteSessionStore(directory, workspace, true, clock);
  }
  static open(directory: unknown, workspace: unknown, clock: () => number = Date.now): SqliteSessionStore {
    return new SqliteSessionStore(directory, workspace, false, clock);
  }
  #scope(input: unknown): SessionBinding {
    const b = parseSessionBinding(input);
    if (b.scope.installation_id !== this.workspace.installation_id || b.scope.workspace_id !== this.workspace.workspace_id) {
      throw new StorageError('E_SCOPE', 'workspace mismatch');
    }
    return b;
  }
  #transaction<T>(write: boolean, action: () => T): T {
    if (this.#closed) throw new StorageError('E_STORAGE', 'connection closed');
    let begun = false;
    try {
      this.#guard(); this.#db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN'); begun = true;
      const value = action();
      this.#db.exec('COMMIT'); begun = false;
      return value;
    } catch (error) {
      if (begun) {
        try { this.#db.exec('ROLLBACK'); }
        catch { this.close(); throw new StorageError('E_STORAGE', 'rollback failed; connection closed'); }
      }
      return storageFailure(error);
    }
  }
  #now(): number {
    const now = timeValue(this.#clock());
    const stored = this.#db.prepare("SELECT value FROM meta WHERE key='clock_high_water_ms'").get()?.value;
    if (typeof stored !== 'string' || !/^(0|[1-9][0-9]*)$/.test(stored)) throw new StorageError('E_STORAGE', 'clock record invalid');
    const prior = timeValue(Number(stored));
    if (now < prior) throw new StorageError('E_OWNER', 'clock moved backward');
    this.#db.prepare("UPDATE meta SET value=? WHERE key='clock_high_water_ms'").run(String(now));
    return now;
  }
  #read(binding: SessionBinding): SessionRecord | null {
    if (this.#db.prepare('SELECT 1 FROM tombstones WHERE scope_hash=? LIMIT 1').get(binding.session_key)) {
      throw new StorageError('E_SCOPE', 'session has retained tombstone');
    }
    const r = this.#db.prepare('SELECT * FROM sessions WHERE session_key=?').get(binding.session_key);
    if (!r) return null;
    if (typeof r.scope_json !== 'string' || typeof r.config_json !== 'string') throw new StorageError('E_STORAGE', 'session record invalid');
    const actual = createSessionBinding(parseJSON(r.scope_json), r.incarnation, r.host_epoch);
    if (canonical(actual) !== canonical(binding)) throw new StorageError('E_SCOPE', 'session incarnation or epoch mismatch');
    const revision = counter(r.view_revision), policy = counter(r.policy_revision);
    const view = this.#db.prepare('SELECT host_epoch,policy_revision FROM views WHERE session_key=? AND revision=?').get(binding.session_key, revision);
    if (!view || view.host_epoch !== actual.host_epoch || view.policy_revision !== policy) throw new StorageError('E_STORAGE', 'session view pointer invalid');
    const owner = r.owner_id === null ? null : entityId(r.owner_id);
    const until = r.lease_until_ms === null ? null : integer(r.lease_until_ms, 1, MAX_TIME + OWNER_LEASE_MS, 'stored.lease');
    if ((owner === null) !== (until === null)) throw new StorageError('E_STORAGE', 'owner record inconsistent');
    return Object.freeze({ binding: actual, config: configuration(parseJSON(r.config_json)),
      view_revision: revision, policy_revision: policy, owner_fence: counter(r.owner_fence), owner_id: owner, lease_until_ms: until,
      mode: choice(r.mode, ['complete', 'assisted', 'unsupported'] as const, 'stored.mode'),
      paused: integer(r.paused, 0, 1, 'stored.paused') === 1, dispatch_blocked: integer(r.dispatch_blocked, 0, 1, 'stored.blocked') === 1 });
  }
  /** Lookup is read-only and does not initialize missing sessions. */
  readSession(input: unknown): SessionRecord | null {
    const b = this.#scope(input);
    return this.#transaction(false, () => this.#read(b));
  }
  /** Scope/incarnation come from explicit authorized initialization, never callbacks. */
  createSession(input: unknown, configInput: unknown): SessionRecord {
    const b = this.#scope(input), config = configuration(configInput);
    if (b.host_epoch !== 0) throw new StorageError('E_SCOPE', 'new session must start at epoch zero');
    return this.#transaction(true, () => {
      const previous = this.#read(b);
      if (previous) {
        if (canonical(previous.config) !== canonical(config)) throw new StorageError('E_CONFLICT', 'session initialization differs');
        return previous;
      }
      const created = new Date(this.#now()).toISOString();
      // Session and View0 become visible together; no INSERT OR REPLACE/upsert reset.
      this.#db.prepare(`INSERT INTO sessions(session_key,incarnation,scope_json,mode,config_json,counters_json,created_at)
        VALUES (?,?,?,'unsupported',?,'{}',?)`).run(b.session_key, b.incarnation, canonical(b.scope), canonical(config), created);
      this.#db.prepare(`INSERT INTO views(session_key,revision,host_epoch,policy_revision,replacements_json,blocks_json,suppressed_json,created_at)
        VALUES (?,0,0,0,'[]','[]','[]',?)`).run(b.session_key, created);
      return this.#read(b)!;
    });
  }
  #require(binding: SessionBinding): SessionRecord {
    const row = this.#read(binding);
    if (!row) throw new StorageError('E_SCOPE', 'session not initialized');
    return row;
  }
  #lease(row: SessionRecord): OwnerLease {
    if (row.owner_id === null || row.lease_until_ms === null || row.owner_fence < 1) throw new StorageError('E_OWNER', 'session has no owner');
    return Object.freeze({ binding: row.binding, owner_id: row.owner_id, owner_fence: row.owner_fence, lease_until_ms: row.lease_until_ms });
  }
  acquireLease(input: unknown): OwnerLease {
    const b = this.#scope(input);
    return this.#transaction(true, () => {
      const row = this.#require(b), now = this.#now();
      if (row.owner_id !== null && row.lease_until_ms! > now) {
        if (row.owner_id !== this.owner_id) throw new StorageError('E_OWNER', 'session owned by another connection');
        return this.#lease(row); // Idempotent acquire does not extend its deadline.
      }
      if (row.owner_fence === Number.MAX_SAFE_INTEGER) throw new StorageError('E_OWNER', 'owner fence exhausted');
      const updated = this.#db.prepare(`UPDATE sessions SET owner_id=?,owner_fence=?,lease_until_ms=?
        WHERE session_key=? AND incarnation=? AND owner_fence=?`).run(this.owner_id, row.owner_fence + 1, now + OWNER_LEASE_MS, b.session_key, b.incarnation, row.owner_fence);
      if (updated.changes !== 1) throw new StorageError('E_OWNER', 'owner compare-and-swap failed');
      return this.#lease(this.#require(b));
    });
  }
  #owned(input: unknown, now: number): OwnerLease {
    const lease = leaseValue(input), b = this.#scope(lease.binding), row = this.#require(b);
    if (lease.owner_id !== this.owner_id || row.owner_id !== lease.owner_id || row.owner_fence !== lease.owner_fence ||
        row.lease_until_ms !== lease.lease_until_ms || lease.lease_until_ms <= now) throw new StorageError('E_OWNER', 'lease expired or superseded');
    return lease;
  }
  #scheduler(row: SessionRecord): SchedulerState | null {
    const r = this.#db.prepare('SELECT * FROM scheduler_state WHERE session_key=?').get(row.binding.session_key);
    if (!r) return null;
    if (r.incarnation !== row.binding.incarnation) throw new StorageError('E_CONFLICT', 'scheduler state incarnation mismatch');
    const attemptNull = r.last_attempt_host_epoch === null;
    if (attemptNull !== (r.last_attempt_coverage_digest === null) || attemptNull !== (r.last_attempt_policy_revision === null) || attemptNull !== (r.last_attempt_config_digest === null)) throw new StorageError('E_STORAGE', 'scheduler attempt state invalid');
    const low = integer(r.low_water_observed, 0, 1, 'scheduler.low_water') === 1;
    if (low !== (r.low_water_host_epoch !== null) || low !== (r.low_water_policy_revision !== null) || low !== (r.low_water_config_digest !== null)) throw new StorageError('E_STORAGE', 'scheduler low-water state invalid');
    const observedNull = r.last_observed_eligible_tokens === null;
    if (observedNull !== (r.last_observed_at_ms === null)) throw new StorageError('E_STORAGE', 'scheduler observation state invalid');
    return Object.freeze({ binding: row.binding, armed: integer(r.armed, 0, 1, 'scheduler.armed') === 1,
      last_attempt: attemptNull ? null : Object.freeze({ host_epoch: integer(r.last_attempt_host_epoch, 0, Number.MAX_SAFE_INTEGER, 'scheduler.attempt.epoch'), coverage_digest: digestValue(r.last_attempt_coverage_digest, 'scheduler.attempt.coverage'), policy_revision: integer(r.last_attempt_policy_revision, 0, Number.MAX_SAFE_INTEGER, 'scheduler.attempt.policy'), config_digest: digestValue(r.last_attempt_config_digest, 'scheduler.attempt.config') }),
      low_water: low ? Object.freeze({ host_epoch: integer(r.low_water_host_epoch, 0, Number.MAX_SAFE_INTEGER, 'scheduler.low.epoch'), policy_revision: integer(r.low_water_policy_revision, 0, Number.MAX_SAFE_INTEGER, 'scheduler.low.policy'), config_digest: digestValue(r.low_water_config_digest, 'scheduler.low.config') }) : null,
      last_observed_eligible_tokens: observedNull ? null : integer(r.last_observed_eligible_tokens, 0, Number.MAX_SAFE_INTEGER, 'scheduler.observed.tokens'), last_observed_at_ms: observedNull ? null : integer(r.last_observed_at_ms, 0, MAX_TIME, 'scheduler.observed.at') });
  }
  readSchedulerState(input: unknown): SchedulerState | null {
    const b = this.#scope(input);
    return this.#transaction(false, () => this.#scheduler(this.#require(b)));
  }
  /** Primary terminal observation only. This neither arms nor admits work. */
  recordPrimaryObservation(leaseInput: unknown, input: unknown): SchedulerState {
    const lease = leaseValue(leaseInput), binding = this.#scope(lease.binding), value = observation(input);
    return this.#transaction(true, () => {
      const now = this.#now(), row = this.#require(binding); this.#owned(lease, now);
      if (value.host_epoch !== binding.host_epoch || value.host_epoch !== row.binding.host_epoch || value.policy_revision !== row.policy_revision || value.observed_at_ms > now) throw new StorageError('E_CONFLICT', 'primary observation is not current');
      const prior = this.#scheduler(row);
      if (prior && prior.last_observed_at_ms !== null && value.observed_at_ms < prior.last_observed_at_ms) throw new StorageError('E_CONFLICT', 'primary observation clock regressed');
      if (!prior) {
        this.#db.prepare(`INSERT INTO scheduler_state(session_key,incarnation,armed,last_observed_eligible_tokens,last_observed_at_ms,low_water_observed,low_water_host_epoch,low_water_policy_revision,low_water_config_digest)
          VALUES (?,?,1,?,?,?, ?,?,?)`).run(binding.session_key, binding.incarnation, value.eligible_tokens, value.observed_at_ms, value.below_rearm_threshold ? 1 : 0,
          value.below_rearm_threshold ? value.host_epoch : null, value.below_rearm_threshold ? value.policy_revision : null, value.below_rearm_threshold ? value.config_digest : null);
      } else if (value.below_rearm_threshold) {
        this.#db.prepare(`UPDATE scheduler_state SET last_observed_eligible_tokens=?,last_observed_at_ms=?,low_water_observed=1,low_water_host_epoch=?,low_water_policy_revision=?,low_water_config_digest=?
          WHERE session_key=? AND incarnation=?`).run(value.eligible_tokens, value.observed_at_ms, value.host_epoch, value.policy_revision, value.config_digest, binding.session_key, binding.incarnation);
      } else {
        const validLow = prior.low_water !== null && prior.low_water.host_epoch === value.host_epoch &&
          prior.low_water.policy_revision === value.policy_revision && prior.low_water.config_digest === value.config_digest;
        this.#db.prepare(`UPDATE scheduler_state SET last_observed_eligible_tokens=?,last_observed_at_ms=?,low_water_observed=?,low_water_host_epoch=?,low_water_policy_revision=?,low_water_config_digest=?
          WHERE session_key=? AND incarnation=?`).run(value.eligible_tokens, value.observed_at_ms, validLow ? 1 : 0,
          validLow ? prior.low_water!.host_epoch : null, validLow ? prior.low_water!.policy_revision : null, validLow ? prior.low_water!.config_digest : null,
          binding.session_key, binding.incarnation);
      }
      this.#owned(lease, this.#now());
      return this.#scheduler(this.#require(binding))!;
    });
  }
  /** Atomic primary-only observation and rearm. It never admits or mutates jobs. */
  observePrimaryAndRearm(leaseInput: unknown, input: unknown): PrimaryRearmResult {
    const lease = leaseValue(leaseInput), binding = this.#scope(lease.binding), value = rearmObservation(input);
    return this.#transaction(true, () => {
      const now = this.#now(), row = this.#require(binding); this.#owned(lease, now);
      if (canonical(value.configuration) !== canonical(row.config) || value.host_epoch !== binding.host_epoch || value.host_epoch !== row.binding.host_epoch ||
          value.policy_revision !== row.policy_revision || value.observed_at_ms > now) throw new StorageError('E_CONFLICT', 'primary rearm observation is not current');
      const prior = this.#scheduler(row);
      if (prior && prior.last_observed_at_ms !== null && value.observed_at_ms < prior.last_observed_at_ms) throw new StorageError('E_CONFLICT', 'primary observation clock regressed');
      const budget = deriveTriggerBudget(row.config);
      const lowWater = value.eligible_tokens < budget.rearm_threshold;
      const validLow = prior !== null && prior.low_water !== null && prior.low_water.host_epoch === value.host_epoch &&
        prior.low_water.policy_revision === value.policy_revision && prior.low_water.config_digest === value.config_digest;
      const lowWaterRearm = validLow && value.eligible_tokens >= budget.trigger_threshold;
      const growthRearm = prior !== null && prior.last_observed_eligible_tokens !== null && prior.last_observed_at_ms !== null && prior.last_attempt !== null &&
        value.eligible_tokens - prior.last_observed_eligible_tokens >= budget.new_tokens &&
        value.observed_at_ms - prior.last_observed_at_ms >= row.config.settings.cooldown_ms &&
        value.coverage_digest !== prior.last_attempt.coverage_digest;
      const reason: PrimaryRearmResult['reason'] = !prior || prior.armed ? null : lowWaterRearm ? 'low_water' : growthRearm ? 'growth' : null;
      const armed = reason !== null || !prior ? 1 : prior.armed ? 1 : 0;
      const retainLow = lowWater || validLow;
      if (!prior) {
        this.#db.prepare(`INSERT INTO scheduler_state(session_key,incarnation,armed,last_observed_eligible_tokens,last_observed_at_ms,low_water_observed,low_water_host_epoch,low_water_policy_revision,low_water_config_digest)
          VALUES (?,?,1,?,?,?, ?,?,?)`).run(binding.session_key, binding.incarnation, value.eligible_tokens, value.observed_at_ms, lowWater ? 1 : 0,
          lowWater ? value.host_epoch : null, lowWater ? value.policy_revision : null, lowWater ? value.config_digest : null);
      } else {
        this.#db.prepare(`UPDATE scheduler_state SET armed=?,last_observed_eligible_tokens=?,last_observed_at_ms=?,low_water_observed=?,low_water_host_epoch=?,low_water_policy_revision=?,low_water_config_digest=?
          WHERE session_key=? AND incarnation=?`).run(armed, value.eligible_tokens, value.observed_at_ms, retainLow ? 1 : 0,
          retainLow ? value.host_epoch : null, retainLow ? value.policy_revision : null, retainLow ? value.config_digest : null,
          binding.session_key, binding.incarnation);
      }
      this.#owned(lease, this.#now());
      return Object.freeze({ state: this.#scheduler(this.#require(binding))!, reason });
    });
  }
  /** C-SCHED primary-only admission. This records intent; it neither dispatches nor projects. */
  admitPrimarySchedulerJob(leaseInput: unknown, input: unknown): PrimarySchedulerAdmission {
    const lease = leaseValue(leaseInput), binding = this.#scope(lease.binding), value = schedulerAdmission(input);
    const context = assertJobContext(binding, value.context, value.expected);
    return this.#jobWrite(lease, (row, now) => {
      assertWorkspaceHold(this.workspace, value.owner_hold);
      if (canonical(value.observation.configuration) !== canonical(row.config) || value.observation.host_epoch !== binding.host_epoch ||
          value.observation.host_epoch !== row.binding.host_epoch || value.observation.policy_revision !== row.policy_revision ||
          value.observation.observed_at_ms > now) {
        throw new StorageError('E_CONFLICT', 'primary scheduler observation is not current');
      }
      const budget = evaluateTrigger(row.config, { effective_input_tokens: value.observation.eligible_tokens }).budget;
      if (value.observation.eligible_tokens < budget.trigger_threshold || value.selected_interval_tokens < 2 * budget.minimum_gain_floor) {
        throw new StorageError('E_BUDGET', 'primary scheduler opportunity is below threshold');
      }
      const scheduler = this.#scheduler(row);
      if (!scheduler || !scheduler.armed || scheduler.last_observed_eligible_tokens !== value.observation.eligible_tokens ||
          scheduler.last_observed_at_ms !== value.observation.observed_at_ms ||
          (scheduler.last_attempt !== null && scheduler.last_attempt.host_epoch === value.observation.host_epoch &&
            scheduler.last_attempt.coverage_digest === value.observation.coverage_digest &&
            scheduler.last_attempt.policy_revision === value.observation.policy_revision &&
            scheduler.last_attempt.config_digest === value.observation.config_digest)) {
        throw new StorageError('E_CONFLICT', 'primary scheduler state is not admissible');
      }
      const snapshot = context.record.snapshot;
      if (snapshot.host_epoch !== value.observation.host_epoch || snapshot.coverage_digest !== value.observation.coverage_digest ||
          snapshot.policy_revision !== value.observation.policy_revision || snapshot.config_digest !== value.observation.config_digest) {
        throw new StorageError('E_CONFLICT', 'job context does not match scheduler opportunity');
      }
      jobs.admitJob(this.#db, row, context, value.expected, now);
      const attempt = jobs.reserveJobAttempt(this.#db, row, value.expected, value.attempt_budget, now);
      bindAttemptOwner(this.#db, lease, value.expected, attempt, value.owner_hold);
      assertWorkspaceHold(this.workspace, value.owner_hold);
      const changed = this.#db.prepare(`UPDATE scheduler_state SET armed=0,last_attempt_host_epoch=?,last_attempt_coverage_digest=?,
        last_attempt_policy_revision=?,last_attempt_config_digest=? WHERE session_key=? AND incarnation=? AND armed=1 AND
        last_observed_eligible_tokens=? AND last_observed_at_ms=?`).run(value.observation.host_epoch, value.observation.coverage_digest,
        value.observation.policy_revision, value.observation.config_digest, binding.session_key, binding.incarnation,
        value.observation.eligible_tokens, value.observation.observed_at_ms);
      if (changed.changes !== 1) throw new StorageError('E_CONFLICT', 'scheduler admission state changed');
      const stored = jobs.requireJob(this.#db, binding, value.expected);
      if (stored.status !== 'running' || stored.attempts.length !== 1) throw new StorageError('E_STORAGE', 'scheduler admission record invalid');
      return Object.freeze({ job: stored, attempt, state: this.#scheduler(this.#require(binding))! });
    });
  }
  renewLease(input: unknown): OwnerLease {
    const parsed = leaseValue(input); this.#scope(parsed.binding);
    return this.#transaction(true, () => {
      const now = this.#now(), lease = this.#owned(parsed, now);
      const changed = this.#db.prepare(`UPDATE sessions SET lease_until_ms=? WHERE session_key=? AND owner_id=? AND owner_fence=? AND lease_until_ms=?`)
        .run(now + OWNER_LEASE_MS, lease.binding.session_key, this.owner_id, lease.owner_fence, lease.lease_until_ms);
      if (changed.changes !== 1) throw new StorageError('E_OWNER', 'renew compare-and-swap failed');
      return this.#lease(this.#require(lease.binding));
    });
  }
  releaseLease(input: unknown): void {
    const parsed = leaseValue(input); this.#scope(parsed.binding);
    this.#transaction(true, () => {
      const lease = this.#owned(parsed, this.#now());
      const changed = this.#db.prepare(`UPDATE sessions SET owner_id=NULL,lease_until_ms=NULL WHERE session_key=? AND owner_id=? AND owner_fence=? AND lease_until_ms=?`)
        .run(lease.binding.session_key, this.owner_id, lease.owner_fence, lease.lease_until_ms);
      if (changed.changes !== 1) throw new StorageError('E_OWNER', 'release compare-and-swap failed');
    });
  }
  /** Retention uses the initialized scope and immutable references, never callback-created sessions. */
  readRootCatalog(input: unknown): RootCatalog {
    const b = this.#scope(input);
    return this.#transaction(false, () => { this.#require(b); return loadRootCatalog(this.#db, b); });
  }
  readRoot(input: unknown, reference: unknown): RootUnit | null {
    const b = this.#scope(input), ref = parseRootRef(reference);
    return this.#transaction(false, () => { this.#require(b); return loadRoot(this.#db, b, ref); });
  }
  readSource(input: unknown, reference: unknown): RetainedSource {
    const b = this.#scope(input), ref = parseSourceRef(reference);
    return this.#transaction(false, () => { this.#require(b); return loadSource(this.#db, b, ref); });
  }
  retainRoots(leaseInput: unknown, batchInput: unknown): RootCatalog {
    const lease = leaseValue(leaseInput), b = this.#scope(lease.binding);
    const batch = prepareRootBatch(b, batchInput);
    return this.#transaction(true, () => {
      this.#owned(lease, this.#now());
      const row = this.#require(b);
      const result = retainRootBatch(this.#db, b, batch, row.policy_revision, new Date(this.#now()).toISOString());
      this.#owned(lease, this.#now()); // A long synchronous batch cannot outlive its admitted lease.
      return result;
    });
  }
  /** Job mutations share current scope and double-checked ownership. */
  #jobWrite<T>(leaseInput: unknown, action: (row: SessionRecord, now: number) => T): T {
    const lease = leaseValue(leaseInput), binding = this.#scope(lease.binding);
    return this.#transaction(true, () => {
      const now = this.#now(); this.#owned(lease, now);
      const result = action(this.#require(binding), now);
      this.#owned(lease, this.#now());
      return result;
    });
  }
  readJob(input: unknown, expectedInput: unknown): StoredJob | null {
    const binding = this.#scope(input), expected = parseJobContextRef(expectedInput);
    return this.#transaction(false, () => { this.#require(binding); return jobs.loadJob(this.#db, binding, expected); });
  }
  #jobFresh(row: SessionRecord, ref: JobContextRef): void {
    jobs.assertJobCurrent(jobs.requireJob(this.#db, row.binding, ref), row, this.#now());
  }
  admitJob(leaseInput: unknown, contextInput: unknown, expectedInput: unknown): StoredJob {
    const lease = leaseValue(leaseInput), expected = parseJobContextRef(expectedInput);
    const context = assertJobContext(this.#scope(lease.binding), contextInput, expected);
    return this.#jobWrite(lease, (row, now) => {
      const prior = jobs.loadJob(this.#db, row.binding, expected);
      const result = jobs.admitJob(this.#db, row, context, expected, now);
      if (!prior) this.#jobFresh(row, expected);
      return result;
    });
  }
  reserveJobAttempt(leaseInput: unknown, expectedInput: unknown, budgetInput: unknown, ownerHold?: unknown): AttemptRef {
    const expected = parseJobContextRef(expectedInput), budget = jobs.parseAttemptBudget(budgetInput);
    return this.#jobWrite(leaseInput, (row, now) => {
      if (ownerHold !== undefined) assertWorkspaceHold(this.workspace, ownerHold);
      const result = jobs.reserveJobAttempt(this.#db, row, expected, budget, now);
      if (ownerHold !== undefined) {
        bindAttemptOwner(this.#db, leaseValue(leaseInput), expected, result, ownerHold);
        assertWorkspaceHold(this.workspace, ownerHold);
      }
      this.#jobFresh(row, expected); return result;
    });
  }
  markJobAttemptDispatched(leaseInput: unknown, expectedInput: unknown, attemptInput: unknown, ownerHold?: unknown): StoredJob {
    const expected = parseJobContextRef(expectedInput), attempt = jobs.parseAttemptRef(attemptInput);
    return this.#jobWrite(leaseInput, (row, now) => {
      assertAttemptOwner(this.#db, leaseValue(leaseInput), expected, attempt, ownerHold);
      const result = jobs.markJobAttemptDispatched(this.#db, row, expected, attempt, now);
      assertAttemptOwner(this.#db, leaseValue(leaseInput), expected, attempt, ownerHold);
      this.#jobFresh(row, expected); return result;
    });
  }
  recordJobAttemptResult(leaseInput: unknown, expectedInput: unknown, attemptInput: unknown, resultInput: unknown, ownerHold?: unknown): StoredJob {
    const expected = parseJobContextRef(expectedInput), attempt = jobs.parseAttemptRef(attemptInput), result = jobs.parseAttemptResult(resultInput);
    return this.#jobWrite(leaseInput, (row, now) => {
      assertAttemptOwner(this.#db, leaseValue(leaseInput), expected, attempt, ownerHold);
      const stored = jobs.recordJobAttemptResult(this.#db, row, expected, attempt, result, now);
      assertAttemptOwner(this.#db, leaseValue(leaseInput), expected, attempt, ownerHold);
      if (jobs.jobIsActive(stored)) this.#jobFresh(row, expected);
      return stored;
    });
  }
  cancelJob(leaseInput: unknown, expectedInput: unknown): StoredJob {
    const expected = parseJobContextRef(expectedInput);
    return this.#jobWrite(leaseInput, (row, now) => jobs.cancelJob(this.#db, row, expected, now));
  }
  confirmJobAttemptStopped(leaseInput: unknown, expectedInput: unknown, attemptInput: unknown, ownerHold?: unknown): StoredJob {
    const expected = parseJobContextRef(expectedInput), attempt = jobs.parseAttemptRef(attemptInput);
    return this.#jobWrite(leaseInput, row => {
      assertAttemptOwner(this.#db, leaseValue(leaseInput), expected, attempt, ownerHold);
      const result = jobs.confirmJobAttemptStopped(this.#db, row, expected, attempt);
      assertAttemptOwner(this.#db, leaseValue(leaseInput), expected, attempt, ownerHold);
      return result;
    });
  }
  /** Diagnostic identity, not authority to resume or declare a task stopped. */
  readAttemptOwnership(input: unknown, expectedInput: unknown, attemptInput: unknown): AttemptOwnership | null {
    const binding = this.#scope(input), expected = parseJobContextRef(expectedInput), attempt = jobs.parseAttemptRef(attemptInput);
    return this.#transaction(false, () => {
      this.#require(binding); jobs.requireJob(this.#db, binding, expected);
      return loadAttemptOwnership(this.#db, binding, expected, attempt);
    });
  }
  /** Preserve an observed fact from the original participant, even after its session lease expires.
   * This deliberately does not authorize any job/run transition or publish a result. */
  recordObservedLocalCompletion(leaseInput: unknown, expectedInput: unknown, attemptInput: unknown,
    observation: unknown, ownerHold: unknown): void {
    const lease = leaseValue(leaseInput), binding = this.#scope(lease.binding);
    const expected = parseJobContextRef(expectedInput), attempt = jobs.parseAttemptRef(attemptInput);
    if (lease.owner_id !== this.owner_id) throw new StorageError('E_OWNER', 'completion requires original store');
    this.#transaction(true, () => {
      this.#require(binding);
      const job = jobs.requireJob(this.#db, binding, expected);
      const selected = job.attempts.find(a => canonical(a.ref) === canonical(attempt));
      if (!selected || selected.state === 'reserved' || job.context.snapshot.owner_fence !== lease.owner_fence) {
        throw new StorageError('E_OWNER', 'completion does not match dispatched generation');
      }
      retainObservedCompletion(this.#db, lease, expected, attempt, observation, ownerHold);
      assertAttemptOwner(this.#db, lease, expected, attempt, ownerHold);
      this.#guard();
    });
  }
  recoverJobs(leaseInput: unknown): readonly StoredJob[] {
    return this.#jobWrite(leaseInput, (row, now) => Object.freeze(jobs.recoverJobs(this.#db, row, now)
      .map(job => reconcileObservedCompletions(this.#db, row.binding, job))));
  }
  /** Closing a connection does not assert that an unknown execution stopped remotely. */
  close(): void {
    if (!this.#closed) { this.#db.close(); this.#closed = true; }
  }
}
