/** Pure SPEC-01 predicate. Evaluates supplied evidence; never certifies a host. */
import { boolean, choice, closedRecord } from './validation.ts';

export const REQUIRED_CAPABILITIES = Object.freeze([
  'identity', 'root_mapping', 'final_capture', 'final_veto', 'substitution',
  'source_retention', 'reset_detection', 'isolated_auxiliary', 'physical_attempt_admission',
  'cancellation_local', 'protocol_validation', 'safe_handoff',
] as const);
export type RequiredCapability = typeof REQUIRED_CAPABILITIES[number];
export type Verification = 'verified' | 'declared' | 'missing' | 'unknown';
export type Fidelity = 'verified' | 'unverified' | 'different';
export type RuntimeGate = 'pass' | 'not_run' | 'fail' | 'blocked';
export type CapabilityEvidence = Readonly<{
  required: Readonly<Partial<Record<RequiredCapability, Verification>>>;
  fidelity?: Fidelity; runtime_gate?: RuntimeGate; reading?: Verification;
  cache?: 'hit' | 'miss' | 'unknown';
}>;
export type CapabilityDecision = Readonly<{ allowed: boolean; mode: 'complete' | 'assisted' | 'unsupported'; blockers: readonly string[] }>;
const STATES = ['verified', 'declared', 'missing', 'unknown'] as const;
const FIDELITY = ['verified', 'unverified', 'different'] as const;
const GATES = ['pass', 'not_run', 'fail', 'blocked'] as const;

/** Missing evidence fails closed. Assisted mode requires separate, explicit consent. */
export function decideMode(evidence: unknown, request: unknown): CapabilityDecision {
  const raw = closedRecord(evidence, ['required', 'fidelity', 'runtime_gate', 'reading', 'cache'], [], 'evidence');
  const required = closedRecord(Object.hasOwn(raw, 'required') ? raw.required : {}, REQUIRED_CAPABILITIES, [], 'evidence.required');
  const verified = new Map<RequiredCapability, Verification>();
  for (const key of REQUIRED_CAPABILITIES) verified.set(key, Object.hasOwn(required, key) ? choice(required[key], STATES, 'evidence.required') : 'unknown');
  const fidelity = Object.hasOwn(raw, 'fidelity') ? choice(raw.fidelity, FIDELITY, 'evidence.fidelity') : 'unverified';
  const gate = Object.hasOwn(raw, 'runtime_gate') ? choice(raw.runtime_gate, GATES, 'evidence.runtime_gate') : 'not_run';
  const reading = Object.hasOwn(raw, 'reading') ? choice(raw.reading, STATES, 'evidence.reading') : 'unknown';
  // Cache is telemetry, deliberately excluded from the authorization predicate.
  if (Object.hasOwn(raw, 'cache')) choice(raw.cache, ['hit', 'miss', 'unknown'] as const, 'evidence.cache');
  const control = closedRecord(request, ['enabled', 'requested_mode', 'assisted_consent'], ['enabled', 'requested_mode', 'assisted_consent'], 'request');
  const enabled = boolean(control.enabled, 'request.enabled');
  const mode = choice(control.requested_mode, ['complete', 'assisted'] as const, 'request.requested_mode');
  const consent = boolean(control.assisted_consent, 'request.assisted_consent');
  const blockers: string[] = [];
  if (!enabled) blockers.push('disabled');
  if (mode === 'complete') {
    for (const key of REQUIRED_CAPABILITIES) if (verified.get(key) !== 'verified') blockers.push(`capability:${key}`);
    if (fidelity !== 'verified') blockers.push(`fidelity:${fidelity}`);
    if (gate !== 'pass') blockers.push(`runtime_gate:${gate}`);
  } else {
    if (!consent) blockers.push('assisted_consent');
    if (verified.get('source_retention') !== 'verified') blockers.push('capability:source_retention');
    if (reading !== 'verified') blockers.push('capability:reading');
  }
  const allowed = blockers.length === 0;
  return Object.freeze({ allowed, mode: allowed ? mode : 'unsupported', blockers: Object.freeze(blockers) });
}
