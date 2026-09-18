import type {OwnerLease, SessionRecord} from '../../packages/storage/src/index.ts';
declare const lease: OwnerLease;
declare const session: SessionRecord;
// @ts-expect-error Persisted lease cannot be silently edited.
lease.owner_fence = 7;
// @ts-expect-error Scoped configuration is immutable.
session.config.settings.enabled = true;
