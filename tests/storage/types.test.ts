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

import type { AttemptOwnership, LocalAttemptOutcome } from '../../packages/storage/src/index.ts';
import { LocalAttemptSupervisor } from '../../packages/storage/src/index.ts';
declare const ownership: AttemptOwnership;
declare const outcome: LocalAttemptOutcome;
// @ts-expect-error Attempt supervisor identity is read-only data, not editable authority.
ownership.storage_owner_id = 'different';
// @ts-expect-error Local stop is assigned by supervision, not an output field of the adapter.
outcome.local_stopped;
// @ts-expect-error The factory is required even for typed callers.
new LocalAttemptSupervisor({}, {}, Symbol());
// @ts-expect-error A process identity cannot be changed on a live issued hold.
held.process_instance = 'other';

import type { SourcePin, SourcePinRequest } from '../../packages/storage/src/index.ts';
declare const pin: SourcePin;
declare const pinRequest: SourcePinRequest;
// @ts-expect-error A pin's scoped reference is immutable.
pin.source_ref.revision = 2;
// @ts-expect-error Only the coordinator can change persisted pin state.
pin.state = 'released';
// @ts-expect-error No filesystem path is accepted in pin options.
pinRequest.staging_path_key = '/arbitrary';

import type { SourcePinRecovery } from '../../packages/storage/src/index.ts';
declare const recoveredPin: SourcePinRecovery;
// @ts-expect-error Recovery result never transfers mutable ownership.
recoveredPin.pin.owner_id = 'different';
// @ts-expect-error A recovery result is immutable, not a mutable control flag.
recoveredPin.state = 'released';

import type { SourcePinPage, SourcePinPageRequest } from '../../packages/storage/src/index.ts';
declare const pinPage: SourcePinPage;
declare const pinPageRequest: SourcePinPageRequest;
// @ts-expect-error Discovery cannot append reservations through a returned page.
pinPage.pins.push(pin);
// @ts-expect-error Returned metadata does not grant mutable owner identity.
pinPage.pins[0]!.owner_id = 'different';
// @ts-expect-error Continuation is immutable diagnostic data.
pinPage.next_after = 'different';
// @ts-expect-error Page bounds are immutable request data.
pinPageRequest.limit = 0;
