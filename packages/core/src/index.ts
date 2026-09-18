export { ContractError } from './validation.ts';
export { DEFAULT_SETTINGS, resolveConfig } from './config.ts';
export type { Settings, ModelLimits, RequestedMode, ResolvedConfiguration } from './config.ts';
export { REQUIRED_CAPABILITIES, decideMode } from './capabilities.ts';
export type { CapabilityEvidence, CapabilityDecision, RequiredCapability, Verification, Fidelity, RuntimeGate } from './capabilities.ts';
export { canonical, parseJSON } from './canonical.mjs';
export { IdentityError, newEntityId, hashSource, hashPayload, parseScope, sessionKey,
  parseWorkContext, createSessionBinding, parseSessionBinding, assertSessionBinding,
  parseToolExecutionRef, toolExecutionKey } from './identity.ts';
export type { Scope, WorkContext, SessionBinding, ToolExecutionRef } from './identity.ts';
export { RootIdentityRegistry, MAX_CATALOG_ROOTS, parseSourceRef, parseRootRef, parseRootUnit } from './roots.ts';
export type { Authority, SourceRef, RootRef, RootUnit, RootEntry, RootCatalog, RootObservation, RootObservationResult } from './roots.ts';

export { parseEntityRef, parseByteRange, parseManifest, verifyManifest, createManifest, assertVerifiedManifest, ManifestError, MAX_MANIFEST_ENTRIES, MAX_MANIFEST_BYTES } from './manifest.ts';
export type { BlockRef, ChapterRef, EntityRef, ByteRange, ManifestEntry, Manifest, VerifiedManifest, CitationSelection, CitationMaterial, CitationResolver } from './manifest.ts';
export { decodeProposal, assertProposalContext, ProposalError, MAX_PROPOSAL_BYTES } from './proposal.ts';
export type { Claim, ModelProposal, ReplacementProposal, ValidatedProposal } from './proposal.ts';
export { createCapture, sealFrame, assertSealedFrame, assertFrameUnchanged, FrameError } from './frame.ts';
export type { Capture, SealedFrame, JSONFrameLayout, NativeGroupIdentity } from './frame.ts';

export { createJSONFrameProfile } from './frame-profile.ts';
export type { JSONFrameProfile, JSONFrameProfileSpec, ProtocolCheck, ProtocolGroup } from './frame-profile.ts';

export { parseSnapshotRecord, MAX_JOB_RECORD_BYTES } from './snapshot.ts';
export type { SnapshotRecord, SnapshotFields } from './snapshot.ts';
export { createJobContext, assertJobContext, exportJobContext, restoreJobContext,
  parseJobContextRecord, parseJobContextRef, decodeJobProposal, assertJobProposal,
  JobContextError, MAX_MISSION_BYTES } from './job-context.ts';
export type { JobContext, JobContextRef, JobContextRecord, JobProposal } from './job-context.ts';
