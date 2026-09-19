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

import type {StoredJob, AttemptRef, AttemptResult} from '../../packages/storage/src/index.ts';
declare const job: StoredJob;
declare const attempt: AttemptRef;
declare const result: AttemptResult;
// @ts-expect-error Persisted job identity is immutable.
job.ref.job_id = 'other';
// @ts-expect-error Attempt identity is immutable.
attempt.attempt_no = 0;
// @ts-expect-error Transport facts are supplied as immutable data.
result.local_stopped = true;
