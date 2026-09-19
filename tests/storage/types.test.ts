import type {OwnerLease, SessionRecord} from '../../packages/storage/src/index.ts';
declare const lease: OwnerLease;
declare const session: SessionRecord;
// @ts-expect-error Persisted lease cannot be silently edited.
lease.owner_fence = 7;
// @ts-expect-error Scoped configuration is immutable.
session.config.settings.enabled = true;

import type {RootRetentionBatch, RetainedSource} from '../../packages/storage/src/index.ts';
declare const batch: RootRetentionBatch;
declare const source: RetainedSource;
// @ts-expect-error A prepared expectation cannot be reassigned in typed code.
batch.expected_catalog_digest = 'changed';
// @ts-expect-error Retained source identity is immutable; bytes are an owned copy.
source.ref.revision = 2;
// @ts-expect-error Native references cannot be appended through the read result.
source.native_refs.push('other');
