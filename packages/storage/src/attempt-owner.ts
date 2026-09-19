/** SPEC-19 association only; a stored identity is not liveness or a network permit. */
import type { DatabaseSync } from 'node:sqlite';
import { canonical, parseJSON } from '../../core/src/canonical.mjs';
import { assertSessionBinding, entityId, hashPayload, parseSessionBinding } from '../../core/src/identity.ts';
import type { SessionBinding } from '../../core/src/identity.ts';
import { parseJobContextRef } from '../../core/src/job-context.ts';
import type { JobContextRef } from '../../core/src/job-context.ts';
import { closedRecord, integer } from '../../core/src/validation.ts';
import { parseAttemptRef } from './job-records.ts';
import type { AttemptRef } from './job-records.ts';
import type { OwnerLease } from './session-store.ts';
import { assertWorkspaceHold } from './workspace-coordinator.ts';
import type { WorkspaceHold } from './workspace-coordinator.ts';
import { StorageError } from './errors.ts';

export type AttemptOwnership = Readonly<{
  schema_version: 1; binding: SessionBinding; job: JobContextRef; attempt: AttemptRef;
  session_owner_id: string; owner_fence: number; storage_owner_id: string; process_instance: string;
}>;
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
function invalid(): never { throw new StorageError('E_STORAGE', 'attempt ownership record invalid'); }
function selected(db: DatabaseSync, b: SessionBinding, ref: AttemptRef): Record<string, unknown> {
  const row = db.prepare(`SELECT a.usage_json FROM attempts a JOIN aux_runs r
    ON r.session_key=a.session_key AND r.job_id=a.job_id AND r.attempt_no=a.attempt_no
    WHERE a.session_key=? AND a.job_id=? AND a.attempt_id=? AND a.attempt_no=? AND r.run_id=?`)
    .get(b.session_key, ref.job_id, ref.attempt_id, ref.attempt_no, ref.run_id);
  if (!row) throw new StorageError('E_CONFLICT', 'attempt ownership target missing');
  return row;
}
export function loadAttemptOwnership(db: DatabaseSync, binding: SessionBinding, job: JobContextRef, attempt: AttemptRef): AttemptOwnership | null {
  const row = selected(db, binding, attempt);
  if (row.usage_json === null) return null;
  try {
    if (typeof row.usage_json !== 'string' || Buffer.byteLength(row.usage_json) > 8192) return invalid();
    const envelope = closedRecord(parseJSON(row.usage_json), ['value','digest'], ['value','digest'], 'attempt.ownership');
    const fields = ['schema_version','binding','job','attempt','session_owner_id','owner_fence','storage_owner_id','process_instance'];
    const v = closedRecord(envelope.value, fields, fields, 'attempt.owner');
    integer(v.schema_version, 1, 1, 'attempt.owner.version');
    const value: AttemptOwnership = Object.freeze({ schema_version: 1, binding: parseSessionBinding(v.binding),
      job: parseJobContextRef(v.job), attempt: parseAttemptRef(v.attempt), session_owner_id: entityId(v.session_owner_id),
      owner_fence: integer(v.owner_fence, 1, Number.MAX_SAFE_INTEGER, 'attempt.owner.fence'),
      storage_owner_id: entityId(v.storage_owner_id), process_instance: entityId(v.process_instance) });
    assertSessionBinding(binding, value.binding);
    if (!equal(value.job, job) || !equal(value.attempt, attempt) || attempt.job_id !== job.job_id || envelope.digest !== hashPayload(value)) return invalid();
    return value;
  } catch { return invalid(); }
}
export function bindAttemptOwner(db: DatabaseSync, lease: OwnerLease, job: JobContextRef, attempt: AttemptRef, input: unknown): AttemptOwnership {
  const hold = assertWorkspaceHold({ installation_id: lease.binding.scope.installation_id, workspace_id: lease.binding.scope.workspace_id }, input);
  const value: AttemptOwnership = Object.freeze({ schema_version: 1, binding: lease.binding, job, attempt,
    session_owner_id: lease.owner_id, owner_fence: lease.owner_fence,
    storage_owner_id: hold.owner_id, process_instance: hold.process_instance });
  const changed = db.prepare('UPDATE attempts SET usage_json=? WHERE session_key=? AND attempt_id=? AND usage_json IS NULL')
    .run(canonical({ value, digest: hashPayload(value) }), lease.binding.session_key, attempt.attempt_id);
  if (changed.changes !== 1) throw new StorageError('E_CONFLICT', 'attempt owner already bound');
  return value;
}
export function assertAttemptOwner(db: DatabaseSync, lease: OwnerLease, job: JobContextRef, attempt: AttemptRef, input: unknown): WorkspaceHold | null {
  const value = loadAttemptOwnership(db, lease.binding, job, attempt);
  if (!value) {
    if (input !== undefined) throw new StorageError('E_CONFLICT', 'legacy attempt cannot acquire supervision retroactively');
    return null;
  }
  const hold = assertWorkspaceHold({ installation_id: lease.binding.scope.installation_id, workspace_id: lease.binding.scope.workspace_id }, input);
  if (value.session_owner_id !== lease.owner_id || value.owner_fence !== lease.owner_fence ||
      value.storage_owner_id !== hold.owner_id || value.process_instance !== hold.process_instance) {
    throw new StorageError('E_OWNER', 'attempt supervisor mismatch');
  }
  return hold;
}
