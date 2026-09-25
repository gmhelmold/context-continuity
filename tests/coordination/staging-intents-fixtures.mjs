/** Private SQLite/lock fixtures for pre-file intents. No physical staging paths exist. */
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { fixture, workspace, id, sql } from '../storage/job-fixtures.mjs';

export { workspace, id, sql };
export const metadataKey = id => `storage.staging-intent.v1:${id}`;
export function stagingFixture(body) {
  return fixture(async f => {
    WorkspaceCoordinator.initialize(f.directory, workspace);
    const coordinator = WorkspaceCoordinator.open(f.directory, workspace);
    const request = { reservation_id: id(101), operation_id: id(102), max_bytes: 1, expected_policy_revision: 0 };
    try { return await body({ ...f, coordinator, request }); }
    finally {
      // Active intents or deliberate owner corruption only revoke local fixture resources here.
      try { coordinator.close(); } catch (error) { if (!['E_CAPABILITY', 'E_OWNER'].includes(error.code)) throw error; }
    }
  });
}
