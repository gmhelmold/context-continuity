/** SPEC-19/20 local task lifecycle. No HTTP, tools, retries, or process-death claim. */
import { types } from 'node:util';
import { canonical } from '../../core/src/canonical.mjs';
import { parseSessionBinding } from '../../core/src/identity.ts';
import { parseJobContextRef } from '../../core/src/job-context.ts';
import type { JobContextRef } from '../../core/src/job-context.ts';
import { closedRecord } from '../../core/src/validation.ts';
import { parseAttemptBudget, parseAttemptRef, parseAttemptResult } from './job-records.ts';
import type { AttemptResult, StoredJob, AttemptRef } from './job-records.ts';
import { SqliteSessionStore } from './session-store.ts';
import type { OwnerLease } from './session-store.ts';
import { WorkspaceCoordinator } from './workspace-coordinator.ts';
import type { AttemptOwnership } from './attempt-owner.ts';
import { observeLocalCompletion } from './local-completion.ts';
import type { LocalStopObservation } from './local-completion.ts';
import { StorageError, storageFailure } from './errors.ts';

// The adapter's Promise must include cleanup; resolving it is its local completion contract.
type WithoutStopped<T> = T extends unknown ? Omit<T, 'local_stopped'> : never;
export type LocalAttemptOutcome = WithoutStopped<AttemptResult>;
export type LocalAttemptOperation = (signal: AbortSignal) => Promise<LocalAttemptOutcome>;
type Task = { attempt: AttemptRef; controller: AbortController; lease: OwnerLease; expected: JobContextRef; ownership: AttemptOwnership };
type PendingCompletion = Readonly<{
  lease: OwnerLease; expected: JobContextRef; attempt: AttemptRef; observation: LocalStopObservation;
}>;
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
  #pendingCompletions = new Map<string, PendingCompletion>();
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
  #lease(lease: OwnerLease): OwnerLease {
    const session = this.store.readSession(lease.binding);
    if (!session || session.owner_id !== this.store.owner_id || canonical({ binding: session.binding, owner_id: session.owner_id,
      owner_fence: session.owner_fence, lease_until_ms: session.lease_until_ms }) !== canonical(lease)) {
      throw new StorageError('E_OWNER', 'supervisor lease mismatch');
    }
    return Object.freeze({ binding: session.binding, owner_id: session.owner_id,
      owner_fence: session.owner_fence, lease_until_ms: session.lease_until_ms! });
  }
  /** Exactly one invocation. This does not grant network permission to an unvalidated adapter. */
  start(lease: OwnerLease, expectedInput: unknown, budgetInput: unknown, operation: LocalAttemptOperation): Promise<StoredJob> {
    this.#available(); adapter(operation);
    const expected = parseJobContextRef(expectedInput), budget = parseAttemptBudget(budgetInput);
    const session = this.store.readSession(lease.binding);
    if (!session || this.#tasks.has(session.binding.session_key) || this.#pendingCompletions.has(session.binding.session_key)) {
      throw new StorageError('E_CONFLICT', 'local operation or completion already tracked');
    }
    const owned = this.#lease(lease);
    const attempt = this.#coordinator.withWorkspaceLock(hold => this.store.reserveJobAttempt(owned, expected, budget, hold));
    // The same identity was bound atomically with the reservation. Storage rechecks it on receipt.
    const ownership: AttemptOwnership = Object.freeze({ schema_version: 1, binding: owned.binding, job: expected, attempt,
      session_owner_id: owned.owner_id, owner_fence: owned.owner_fence,
      storage_owner_id: this.#coordinator.owner_id, process_instance: this.#coordinator.process_instance });
    const task: Task = { attempt, lease: owned, expected, ownership, controller: new AbortController() };
    this.#tasks.set(owned.binding.session_key, task);
    try {
      this.#coordinator.withWorkspaceLock(hold => this.store.markJobAttemptDispatched(owned, expected, attempt, hold));
    } catch (cause) {
      // No adapter was invoked. Reconcile only with the still-valid generation.
      // A failure after COMMIT can leave dispatched rather than reserved state.
      try {
        this.#coordinator.withWorkspaceLock(hold => {
          const job = this.store.cancelJob(owned, expected);
          if (job.attempts.some(a => a.ref.run_id === attempt.run_id && a.local_state === 'quarantine')) {
            this.store.confirmJobAttemptStopped(owned, expected, attempt, hold);
          }
        });
      } catch { /* Keep the original failure; the durable record remains conservative. */ }
      this.#tasks.delete(owned.binding.session_key);
      return Promise.reject(cause);
    }
    return this.#perform(task, operation);
  }
  /** Starts one existing supervised reservation. It neither reserves nor admits work. */
  adopt(lease: OwnerLease, expectedInput: unknown, attemptInput: unknown, operation: LocalAttemptOperation): Promise<StoredJob> {
    this.#available(); adapter(operation);
    const expected = parseJobContextRef(expectedInput), attempt = parseAttemptRef(attemptInput), owned = this.#lease(lease);
    if (this.#tasks.has(owned.binding.session_key) || this.#pendingCompletions.has(owned.binding.session_key)) {
      throw new StorageError('E_CONFLICT', 'local operation or completion already tracked');
    }
    const ownership = this.store.readAttemptOwnership(owned.binding, expected, attempt);
    if (!ownership || canonical(ownership.job) !== canonical(expected) || canonical(ownership.attempt) !== canonical(attempt) ||
        ownership.session_owner_id !== owned.owner_id || ownership.owner_fence !== owned.owner_fence ||
        ownership.storage_owner_id !== this.#coordinator.owner_id || ownership.process_instance !== this.#coordinator.process_instance) {
      throw new StorageError('E_OWNER', 'attempt is not owned by this supervisor');
    }
    const task: Task = { attempt, lease: owned, expected, ownership, controller: new AbortController() };
    // Dispatch rechecks lease, ownership, live hold, current context, and reserved attempt atomically.
    this.#coordinator.withWorkspaceLock(hold => {
      this.store.markJobAttemptDispatched(owned, expected, attempt, hold);
    });
    this.#tasks.set(owned.binding.session_key, task);
    return this.#perform(task, operation);
  }
  async #perform(task: Task, operation: LocalAttemptOperation): Promise<StoredJob> {
    let result: AttemptResult, localStopped = false;
    let observation: LocalStopObservation | undefined;
    try {
      const pending = operation(task.controller.signal);
      if (!types.isPromise(pending)) throw new StorageError('E_CAPABILITY', 'local operation must return a Promise');
      const settled = await observeLocalCompletion(task.ownership, pending);
      localStopped = true;
      observation = settled.observation;
      if (!settled.fulfilled) throw new StorageError('E_CAPABILITY', 'local operation rejected');
      result = outcome(settled.value);
    } catch { result = Object.freeze({ kind: 'aborted' as const, local_stopped: localStopped }); }
    if (observation !== undefined) {
      // Retain only the issued fact and its original identity, never the response or adapter.
      this.#pendingCompletions.set(task.lease.binding.session_key, Object.freeze({
        lease: task.lease, expected: task.expected, attempt: task.attempt, observation,
      }));
    }
    try {
      return this.#coordinator.withWorkspaceLock(hold => {
        // This records only a fact from the original participant, not publication authority.
        if (observation !== undefined) this.store.recordObservedLocalCompletion(task.lease, task.expected, task.attempt, observation, hold);
        // A storage error must leave the observation available for an explicit receipt retry.
        if (observation !== undefined) this.#pendingCompletions.delete(task.lease.binding.session_key);
        // Renewal may extend time, but cannot change the admitted generation/owner.
        const session = this.store.readSession(task.lease.binding);
        if (!session || session.owner_id !== task.lease.owner_id || session.owner_fence !== task.lease.owner_fence || session.lease_until_ms === null) {
          throw new StorageError('E_OWNER', 'supervisor lost its session generation');
        }
        const lease = Object.freeze({ ...task.lease, lease_until_ms: session.lease_until_ms });
        let job = this.store.recordJobAttemptResult(lease, task.expected, task.attempt, result, hold);
        if (result.local_stopped && job.attempts.some(a => a.ref.run_id === task.attempt.run_id && a.local_state === 'quarantine')) {
          job = this.store.confirmJobAttemptStopped(lease, task.expected, task.attempt, hold);
        }
        return job;
      });
    } finally {
      // Invalid adapter protocol has no completion observation. Signal cancellation
      // without claiming cleanup; its durable quarantine survives this bookkeeping.
      try { if (!result.local_stopped) task.controller.abort(); }
      finally { this.#tasks.delete(task.lease.binding.session_key); }
    }
  }
  /** Retry only a previously observed receipt. Never invokes an adapter or publishes its result.
   * False means no fact is pending in this instance, not that the ledger has no receipt. */
  flushLocalCompletion(bindingInput: unknown, expectedInput: unknown): boolean {
    this.#available();
    const binding = parseSessionBinding(bindingInput), expected = parseJobContextRef(expectedInput);
    if (binding.scope.installation_id !== this.store.workspace.installation_id ||
        binding.scope.workspace_id !== this.store.workspace.workspace_id) {
      throw new StorageError('E_SCOPE', 'completion workspace mismatch');
    }
    const pending = this.#pendingCompletions.get(binding.session_key);
    if (pending === undefined) return false;
    if (canonical(pending.lease.binding) !== canonical(binding)) throw new StorageError('E_SCOPE', 'completion binding mismatch');
    if (canonical(pending.expected) !== canonical(expected)) throw new StorageError('E_CONFLICT', 'completion generation mismatch');
    this.#coordinator.withWorkspaceLock(hold => this.store.recordObservedLocalCompletion(
      pending.lease, pending.expected, pending.attempt, pending.observation, hold));
    // Only acknowledge after storage and the section's final guards return successfully.
    this.#pendingCompletions.delete(binding.session_key);
    return true;
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
    // Explicit close abandons only local retry bookkeeping; it cannot clear durable quarantine.
    this.#pendingCompletions.clear();
    let failure: unknown;
    try { this.store.close(); } catch (cause) { failure = cause; }
    try { this.#coordinator.close(); } catch (cause) { failure ??= cause; }
    if (failure !== undefined) storageFailure(failure);
  }
}
