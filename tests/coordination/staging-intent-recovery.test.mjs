/** SPEC-25: one identified pre-file reservation, never general owner recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { stagingFixture, workspace, sql } from './staging-intents-fixtures.mjs';

const fails = (fn, code) => assert.throws(fn, error => error.code === code);

test('Staging recovery: live owner stays held; closed foreign owner releases one pre-file charge', () => stagingFixture(f => {
  const intent = f.coordinator.reserveStaging(f.b, f.request);
  const before = f.coordinator.readStorageBudget().used_bytes;
  assert.equal(f.coordinator.recoverStaging(f.b, intent.reservation_id).state, 'held');
  assert.equal(f.coordinator.readStorageBudget().used_bytes, before);
  fails(() => f.coordinator.close(), 'E_CAPABILITY');

  const recovery = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    const result = recovery.recoverStaging(f.b, intent.reservation_id);
    assert.equal(result.state, 'cancelled');
    assert.equal(result.intent.state, 'cancelled');
    assert.equal(result.intent.owner_id, intent.owner_id);
    assert.equal(recovery.readStorageBudget().used_bytes, before - intent.max_bytes);
    assert.equal(sql(f, 'SELECT count(*) AS n FROM storage_reservations WHERE reservation_id=?', intent.reservation_id)[0].n, 0);
    assert.deepEqual(recovery.recoverStaging(f.b, intent.reservation_id), result);
  } finally { recovery.close(); }
}));

for (const state of ['staging', 'complete', 'cleanup_pending']) test(`Staging recovery: ${state} managed file keeps reservation charged`, () => stagingFixture(f => {
  const intent = f.coordinator.reserveStaging(f.b, f.request);
  sql(f, 'INSERT INTO managed_files(path_key,kind,operation_id,state,scopes_json) VALUES (?,?,?,?,?)',
    `synthetic/${state}`, 'synthetic', intent.operation_id, state, '{}');
  const before = f.coordinator.readStorageBudget().used_bytes;
  fails(() => f.coordinator.close(), 'E_CAPABILITY');

  const recovery = WorkspaceCoordinator.open(f.directory, workspace);
  try {
    fails(() => recovery.recoverStaging(f.b, intent.reservation_id), 'E_CONFLICT');
    assert.equal(recovery.readStorageBudget().used_bytes, before);
    assert.equal(recovery.readStaging(f.b, intent.reservation_id).state, 'reserved');
  } finally { recovery.close(); }
}));
