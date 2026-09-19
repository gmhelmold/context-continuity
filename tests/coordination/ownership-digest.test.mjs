/** Isolates the original association checksum before any completion receipt exists. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { fixture, workspace, amount, sql } from '../storage/job-fixtures.mjs';

test('Supervisor: ownership digest is verified before a completion receipt exists', () => fixture(f => {
  WorkspaceCoordinator.initialize(f.directory, workspace);
  const c = WorkspaceCoordinator.open(f.directory, workspace), job = f.job();
  try {
    f.s.admitJob(f.lease, job, job.ref);
    const a = c.withWorkspaceLock(h => f.s.reserveJobAttempt(f.lease, job.ref, amount, h));
    const text = sql(f, 'SELECT usage_json FROM attempts WHERE attempt_id=?', a.attempt_id)[0].usage_json;
    const record = JSON.parse(text); assert.equal(Object.hasOwn(record, 'local_stop'), false);
    assert.equal(f.s.readAttemptOwnership(f.b, job.ref, a).owner_fence, f.lease.owner_fence);
    record.value.owner_fence++;
    sql(f, 'UPDATE attempts SET usage_json=? WHERE attempt_id=?', JSON.stringify(record), a.attempt_id);
    assert.throws(() => f.s.readAttemptOwnership(f.b, job.ref, a), e => e.code === 'E_STORAGE');
    sql(f, 'UPDATE attempts SET usage_json=? WHERE attempt_id=?', text, a.attempt_id);
    assert.equal(f.s.readAttemptOwnership(f.b, job.ref, a).owner_fence, f.lease.owner_fence);
  } finally { c.close(); }
}));
