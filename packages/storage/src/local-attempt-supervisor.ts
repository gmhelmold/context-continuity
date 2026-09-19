/** SPEC-19 local task lifecycle. No HTTP, tools, retries, or cross-process stop claim. */
import { types } from 'node:util';
import { canonical } from '../../core/src/canonical.mjs';
import { parseJobContextRef } from '../../core/src/job-context.ts';
import type { JobContextRef } from '../../core/src/job-context.ts';
import { closedRecord } from '../../core/src/validation.ts';
import { parseAttemptBudget, parseAttemptResult } from './job-records.ts';
import type { AttemptResult, StoredJob, AttemptRef } from './job-records.ts';
import { SqliteSessionStore } from './session-store.ts';
import type { OwnerLease } from './session-store.ts';
import { WorkspaceCoordinator } from './workspace-coordinator.ts';
import { StorageError, storageFailure } from './errors.ts';

// The adapter's Promise must include cleanup; resolving it is its local completion contract.
type WithoutStopped<T> = T extends unknown ? Omit<T, 'local_stopped'> : never;
export type LocalAttemptOutcome = WithoutStopped<AttemptResult>;
export type LocalAttemptOperation = (signal: AbortSignal) => Promise<LocalAttemptOutcome>;
type Task = { attempt: AttemptRef; controller: AbortController; lease: OwnerLease; expected: JobContextRef };
const construction = Symbol('LocalAttemptSupervisor');
function outcome(value: unknown): AttemptResult {
  const fields = ['kind','text','finish','parent_input_tokens','candidate_input_tokens','status','retry_after_ms'];
  const record = closedRecord(value, fields, ['kind'], 'local.outcome');
  return parseAttemptResult({ ...record, local_stopped: true });
}
function adapter(input: unknown): asserts input is LocalAttemptOperation {
  if (typeof input !== 'function' || types.isGeneratorFunction(input)) {
    throw new StorageError('E_CAPABILITY', 'local operation function required');
  }
}
export class LocalAttemptSupervisor {
  readonly store: SqliteSessionStore;
  #coordinator: WorkspaceCoordinator;
  #tasks = new Map<string, Task>();
  #closed = false;
  private constructor(store: SqliteSessionStore, coordinator: WorkspaceCoordinator, key: symbol) {
    if (key !== construction) throw new StorageError('E_OWNER', 'supervisor must be opened through its factory');
    this.store = store; this.#coordinator = coordinator; Object.freeze(this);
  }
  /** Existing initialized coordinator workspace only. No bootstrap or replay on open. */
  static open(directory: unknown, workspace: unknown, clock: () => number = Date.now): LocalAttemptSupervisor {
    const coordinator = WorkspaceCoordinator.open(directory, workspace);
    try { return new LocalAttemptSupervisor(SqliteSessionStore.open(directory, workspace, clock), coordinator, construction); }
    catch (cause) { try { coordinator.close(); } catch { /* Preserve admission failure. */ } return storageFailure(cause); }
  }
  #available(): void { if (this.#closed) throw new StorageError('E_OWNER', 'supervisor closed'); }
  /** Exactly one invocation. This does not grant network permission to an unvalidated adapter. */
  start(lease: OwnerLease, expectedInput: unknown, budgetInput: unknown, operation: LocalAttemptOperation): Promise<StoredJob> {
    this.#available(); adapter(operation);
    const expected = parseJobContextRef(expectedInput), budget = parseAttemptBudget(budgetInput);
    const session = this.store.readSession(lease.binding);
    if (!session || this.#tasks.has(session.binding.session_key)) throw new StorageError('E_CONFLICT', 'local operation already tracked');
    // Immutable current lease data are copied instead of retaining a caller-mutable object.
    if (session.owner_id !== this.store.owner_id || canonical({ binding: session.binding, owner_id: session.owner_id,
      owner_fence: session.owner_fence, lease_until_ms: session.lease_until_ms }) !== canonical(lease)) {
      throw new StorageError('E_OWNER', 'supervisor lease mismatch');
    }
    const owned = Object.freeze({ binding: session.binding, owner_id: session.owner_id,
      owner_fence: session.owner_fence, lease_until_ms: session.lease_until_ms! });
    const attempt = this.#coordinator.withWorkspaceLock(hold => this.store.reserveJobAttempt(owned, expected, budget, hold));
    const task: Task = { attempt, lease: owned, expected, controller: new AbortController() };
    this.#tasks.set(session.binding.session_key, task);
    try {
      this.#coordinator.withWorkspaceLock(hold => this.store.markJobAttemptDispatched(owned, expected, attempt, hold));
    } catch (cause) {
      this.#tasks.delete(session.binding.session_key);
      // A failed dispatch did not invoke operation. Preserve the reservation and surface the error.
      return Promise.reject(cause);
    }
    return this.#perform(task, operation);
  }
  async #perform(task: Task, operation: LocalAttemptOperation): Promise<StoredJob> {
    let result: AttemptResult;
    try { result = outcome(await operation(task.controller.signal)); }
    catch { result = Object.freeze({ kind: 'aborted' as const, local_stopped: true }); }
    try {
      return this.#coordinator.withWorkspaceLock(hold => {
        // Renewal may extend time, but cannot change the admitted generation/owner.
        const session = this.store.readSession(task.lease.binding);
        if (!session || session.owner_id !== task.lease.owner_id || session.owner_fence !== task.lease.owner_fence || session.lease_until_ms === null) {
          throw new StorageError('E_OWNER', 'supervisor lost its session generation');
        }
        const lease = Object.freeze({ ...task.lease, lease_until_ms: session.lease_until_ms });
        let job = this.store.recordJobAttemptResult(lease, task.expected, task.attempt, result, hold);
        if (job.attempts.some(a => a.ref.run_id === task.attempt.run_id && a.local_state === 'quarantine')) {
          job = this.store.confirmJobAttemptStopped(lease, task.expected, task.attempt, hold);
        }
        return job;
      });
    } finally { this.#tasks.delete(task.lease.binding.session_key); }
  }
  /** Commit cancellation before signaling; a pending adapter still owns its execution slot. */
  cancel(lease: OwnerLease, expectedInput: unknown): StoredJob {
    this.#available(); const expected = parseJobContextRef(expectedInput);
    const task = this.#tasks.get(lease.binding.session_key);
    if (task && canonical(task.expected) !== canonical(expected)) throw new StorageError('E_CONFLICT', 'different local job');
    const job = this.#coordinator.withWorkspaceLock(() => this.store.cancelJob(lease, expected));
    task?.controller.abort(); return job;
  }
  close(): void {
    if (this.#closed) return;
    if (this.#tasks.size) throw new StorageError('E_CONFLICT', 'local operations have not stopped');
    this.#closed = true;
    let failure: unknown;
    try { this.store.close(); } catch (cause) { failure = cause; }
    try { this.#coordinator.close(); } catch (cause) { failure ??= cause; }
    if (failure !== undefined) storageFailure(failure);
  }
}
