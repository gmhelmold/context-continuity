// Compile-time regression guards; this file is not executed as JavaScript.
import type { Settings, CapabilityDecision, RequestedMode } from '../../packages/core/src/index.ts';
declare const settings: Settings;
declare const decision: CapabilityDecision;
// @ts-expect-error resolved configuration is immutable
settings.enabled = true;
// @ts-expect-error decisions are immutable
 decision.allowed = true;
// @ts-expect-error blocker arrays are readonly
 decision.blockers.push('new');
// @ts-expect-error a mode is not an arbitrary string
const invalid: RequestedMode = 'auto';
void invalid;

import type { RootUnit, SessionBinding, RootCatalog } from '../../packages/core/src/index.ts';
import { RootIdentityRegistry } from '../../packages/core/src/index.ts';
declare const unit: RootUnit;
declare const binding: SessionBinding;
declare const catalog: RootCatalog;
declare const registry: RootIdentityRegistry;
// @ts-expect-error source references are immutable
unit.source_refs.push({ source_id: 'x', revision: 0, digest: 'x' });
// @ts-expect-error nested coverage is immutable
unit.root_coverage[0]!.revision = 4;
// @ts-expect-error a root cannot become a synthetic chapter
unit.kind = 'chapter';
// @ts-expect-error scope is immutable
binding.scope.workspace_id = 'other';
// @ts-expect-error catalog is immutable
catalog.entries[0]!.native_identity = 'other';
// @ts-expect-error registry cannot be rebound
registry.binding = binding;

import type { Manifest, VerifiedManifest, Capture, SealedFrame, ValidatedProposal } from '../../packages/core/src/index.ts';
declare const manifest: Manifest;
declare const verifiedManifest: VerifiedManifest;
declare const partialCapture: Capture;
declare const sealedFrame: SealedFrame;
declare const decodedProposal: ValidatedProposal;
// @ts-expect-error structural validation is not source verification
const notVerified: VerifiedManifest = manifest;
// @ts-expect-error a capture is not a final frame
const notSealed: SealedFrame = partialCapture;
// @ts-expect-error manifest entries are readonly
verifiedManifest.manifest.entries.push(manifest.entries[0]);
// @ts-expect-error provenance cannot be changed in place
verifiedManifest.binding.incarnation = 'other';
// @ts-expect-error the copied envelope pointer is immutable
sealedFrame.envelope = null;
// @ts-expect-error proposal/manifest association is immutable
decodedProposal.manifest_digest = 'other';
void notVerified; void notSealed;

import type { JSONFrameProfile } from '../../packages/core/src/index.ts';
declare const profile: JSONFrameProfile;
// @ts-expect-error profile limits are immutable
profile.spec.limits.context_window = 1;
// @ts-expect-error aliases are immutable
profile.spec.model_aliases.push('implicit');

import type { JobContext, JobContextRecord, JobProposal, SnapshotRecord } from '../../packages/core/src/index.ts';
declare const jobContext: JobContext;
declare const jobRecord: JobContextRecord;
declare const jobProposal: JobProposal;
declare const snapshot: SnapshotRecord;
// @ts-expect-error serialized data is not an issued handle
const badJobContext: JobContext = { ref: jobContext.ref, record: jobRecord };
void badJobContext;
// @ts-expect-error immutable generation identity
jobContext.ref.job_id = 'other';
// @ts-expect-error nested snapshot feedback is immutable
snapshot.feedback_ids.push('other');
// @ts-expect-error immutable generation association
jobProposal.ref.snapshot_digest = 'other';
// @ts-expect-error snapshot cannot be rewritten through exported record
jobRecord.snapshot.work.task_id = 'other';
