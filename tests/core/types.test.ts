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
