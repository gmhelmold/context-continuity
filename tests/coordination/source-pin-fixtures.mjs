/** Private SQLite/lock fixtures; no real transcripts or provider requests. */
import { WorkspaceCoordinator } from '../../packages/storage/src/index.ts';
import { fixture, workspace, id, sql } from '../storage/job-fixtures.mjs';
export { workspace, id, sql };
export const metadataKey = id => `storage.source-pin.v1:${id}`;
export function pinFixture(body) {
  return fixture(async f => {
    WorkspaceCoordinator.initialize(f.directory, workspace);
    const coordinator = WorkspaceCoordinator.open(f.directory, workspace);
    const request = { reservation_id: id(101), operation_id: id(102), kind: 'read_pin', source_ref: f.source.ref };
    try { return await body({ ...f, coordinator, request }); }
    finally {
      // Several tests intentionally retain pins. close revokes/frees resources,
      // but reports retained reservations; the fixture never pretends to release them.
      try { coordinator.close(); } catch (e) { if (e.code !== 'E_CAPABILITY') throw e; }
    }
  });
}
