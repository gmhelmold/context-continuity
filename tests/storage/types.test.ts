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

import type { LockResources, OwnerFile } from '../../packages/storage/src/lock-resources.ts';
declare const resources: LockResources;
declare const ownerFile: OwnerFile;
// @ts-expect-error Resource identity cannot be reassigned.
resources.identity.lock.ino = 'other';
// @ts-expect-error Descriptors are not public capabilities.
ownerFile.fd;
// @ts-expect-error Paths are readonly after admission.
resources.directory = '/other';

import type { WorkspaceHold, StorageOwner } from '../../packages/storage/src/index.ts';
declare const held: WorkspaceHold;
declare const registered: StorageOwner;
// @ts-expect-error Workspace and owner authority cannot be mutated.
held.owner_id = 'different';
// @ts-expect-error Owner file identity is deeply immutable.
registered.identity.ino = '0';
// @ts-expect-error Plain data cannot manufacture an issued section.
const fabricated: WorkspaceHold = { workspace: held.workspace, owner_id: held.owner_id };
void fabricated;
