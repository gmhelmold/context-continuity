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
