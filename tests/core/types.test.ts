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
