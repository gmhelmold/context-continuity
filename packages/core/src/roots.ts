/** SPEC-01 root identities. In-memory bookkeeping; callers must durably commit exports in WP-02. */
import { boolean, choice, closedRecord, ContractError, integer } from './validation.ts';
import { assertSessionBinding, digestValue, entityId, hashPayload, IdentityError,
  newEntityId, opaqueId, parseSessionBinding } from './identity.ts';
import type { SessionBinding } from './identity.ts';

export type Authority = 'user' | 'host' | 'agent' | 'external';
export type SourceRef = Readonly<{ source_id: string; revision: number; digest: string }>;
export type RootRef = Readonly<{ unit_id: string; revision: number; unit_digest: string }>;
export type RootUnit = Readonly<{
  unit_id: string; revision: number; kind: 'root'; authority: Authority;
  protocol_group: string; completed: boolean; protected: boolean;
  native_refs: readonly string[]; source_refs: readonly SourceRef[];
  root_coverage: readonly RootRef[]; payload_ref: string;
  payload_digest: string; unit_digest: string; estimated_tokens: number;
}>;
export type RootEntry = Readonly<{ native_identity: string; unit: RootUnit }>;
export type RootCatalog = Readonly<{ schema_version: 1; binding: SessionBinding; entries: readonly RootEntry[]; catalog_digest: string }>;
export type RootObservation = Readonly<{
  native_identity: string; authority: Authority; protocol_group: string;
  completed: boolean; protected: boolean; native_refs: readonly string[];
  source_refs: readonly SourceRef[]; payload_ref: string; payload: unknown; estimated_tokens: number;
}>;
export type RootObservationResult = Readonly<{ unit: RootUnit; change: 'created' | 'revised' | 'metadata' | 'unchanged' }>;
const MAX = Number.MAX_SAFE_INTEGER;
// Finite contract-object bound, not retention or a model-context limit.
export const MAX_CATALOG_ROOTS = 100000;
const AUTHORITY = ['user', 'host', 'agent', 'external'] as const;

function list(input: unknown, field: string): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > MAX_CATALOG_ROOTS || Reflect.ownKeys(input).length !== input.length + 1) {
    throw new ContractError(field, 'expected a bounded dense array');
  }
  const values: unknown[] = [];
  for (let i = 0; i < input.length; i++) {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw new ContractError(field, 'expected data elements');
    values.push(d.value as unknown);
  }
  return values;
}
function unique<T>(values: readonly T[], key: (value: T) => string, field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) throw new ContractError(field, 'duplicate identity');
    seen.add(id);
  }
}
export function parseSourceRef(input: unknown): SourceRef {
  const f = ['source_id', 'revision', 'digest'];
  const v = closedRecord(input, f, f, 'source_ref');
  return Object.freeze({ source_id: entityId(v.source_id, 'source_ref.source_id'),
    revision: integer(v.revision, 0, MAX, 'source_ref.revision'), digest: digestValue(v.digest, 'source_ref.digest') });
}
export function parseRootRef(input: unknown): RootRef {
  const f = ['unit_id', 'revision', 'unit_digest'];
  const v = closedRecord(input, f, f, 'root_ref');
  return Object.freeze({ unit_id: entityId(v.unit_id, 'root_ref.unit_id'),
    revision: integer(v.revision, 0, MAX, 'root_ref.revision'), unit_digest: digestValue(v.unit_digest, 'root_ref.unit_digest') });
}
function sourceRefs(input: unknown): readonly SourceRef[] {
  const refs = list(input, 'source_refs').map(parseSourceRef);
  unique(refs, r => `${r.source_id}:${r.revision}`, 'source_refs');
  return Object.freeze(refs);
}
function nativeRefs(input: unknown): readonly string[] {
  const refs = list(input, 'native_refs').map(v => opaqueId(v, 'native_refs'));
  if (!refs.length) throw new ContractError('native_refs', 'at least one public identity is required');
  unique(refs, r => r, 'native_refs');
  return Object.freeze(refs);
}
function material(unit: Pick<RootUnit, 'kind' | 'authority' | 'protocol_group' | 'completed' | 'protected' | 'native_refs' | 'source_refs' | 'payload_digest'>) {
  return { kind: unit.kind, authority: unit.authority, protocol_group: unit.protocol_group,
    completed: unit.completed, protected: unit.protected, native_refs: unit.native_refs,
    source_refs: unit.source_refs, payload_digest: unit.payload_digest };
}
/** Exact SPEC-01 formula; storage locator and estimates are not semantic content. */
function unitDigest(unit: Pick<RootUnit, 'unit_id' | 'revision'> & Parameters<typeof material>[0]): string {
  return hashPayload({ unit_id: unit.unit_id, revision: unit.revision, ...material(unit) });
}

export function parseRootUnit(input: unknown): RootUnit {
  const f = ['unit_id', 'revision', 'kind', 'authority', 'protocol_group', 'completed', 'protected',
    'native_refs', 'source_refs', 'root_coverage', 'payload_ref', 'payload_digest', 'unit_digest', 'estimated_tokens'];
  const v = closedRecord(input, f, f, 'root');
  const unit = {
    unit_id: entityId(v.unit_id, 'root.unit_id'), revision: integer(v.revision, 0, MAX, 'root.revision'),
    kind: choice(v.kind, ['root'] as const, 'root.kind'), authority: choice(v.authority, AUTHORITY, 'root.authority'),
    protocol_group: opaqueId(v.protocol_group, 'root.protocol_group'), completed: boolean(v.completed, 'root.completed'),
    protected: boolean(v.protected, 'root.protected'), native_refs: nativeRefs(v.native_refs), source_refs: sourceRefs(v.source_refs),
    root_coverage: Object.freeze(list(v.root_coverage, 'root_coverage').map(parseRootRef)),
    payload_ref: opaqueId(v.payload_ref, 'root.payload_ref'), payload_digest: digestValue(v.payload_digest, 'root.payload_digest'),
    unit_digest: digestValue(v.unit_digest, 'root.unit_digest'), estimated_tokens: integer(v.estimated_tokens, 0, MAX, 'root.estimated_tokens'),
  };
  if ((!unit.completed || unit.source_refs.length === 0) && !unit.protected) throw new ContractError('root.protected', 'unretained or incomplete root must be protected');
  if (unitDigest(unit) !== unit.unit_digest) throw new ContractError('root.unit_digest', 'content mismatch');
  const self = unit.root_coverage[0];
  if (unit.root_coverage.length !== 1 || !self || self.unit_id !== unit.unit_id || self.revision !== unit.revision || self.unit_digest !== unit.unit_digest) {
    throw new ContractError('root.root_coverage', 'root must cover exactly itself');
  }
  return Object.freeze(unit);
}

function observeInput(input: unknown) {
  const f = ['native_identity', 'authority', 'protocol_group', 'completed', 'protected', 'native_refs', 'source_refs', 'payload_ref', 'payload', 'estimated_tokens'];
  const v = closedRecord(input, f, f, 'observation');
  const completed = boolean(v.completed, 'observation.completed');
  const refs = sourceRefs(v.source_refs);
  return {
    native_identity: opaqueId(v.native_identity, 'observation.native_identity'), kind: 'root' as const,
    authority: choice(v.authority, AUTHORITY, 'observation.authority'), protocol_group: opaqueId(v.protocol_group, 'observation.protocol_group'),
    completed, protected: boolean(v.protected, 'observation.protected') || !completed || refs.length === 0,
    native_refs: nativeRefs(v.native_refs), source_refs: refs,
    payload_ref: opaqueId(v.payload_ref, 'observation.payload_ref'), payload_digest: hashPayload(v.payload),
    estimated_tokens: integer(v.estimated_tokens, 0, MAX, 'observation.estimated_tokens'),
  };
}

/** One registry per explicit session incarnation/epoch. Export order is discovery, NOT chronology.
 * Exported records contain refs/digests, not source bytes. Checksums establish consistency,
 * not authenticity, availability or permission to emit a request.
 */
export class RootIdentityRegistry {
  #binding: SessionBinding;
  get binding(): SessionBinding { return this.#binding; }
  #entries = new Map<string, RootEntry>();
  #nativeOwners = new Map<string, string>();
  #unitIds = new Set<string>();

  constructor(binding: unknown, persisted?: unknown) {
    this.#binding = parseSessionBinding(binding);
    if (persisted === undefined) return;
    const f = ['schema_version', 'binding', 'entries', 'catalog_digest'];
    const raw = closedRecord(persisted, f, f, 'catalog');
    integer(raw.schema_version, 1, 1, 'catalog.schema_version');
    assertSessionBinding(this.binding, raw.binding);
    const expectedDigest = digestValue(raw.catalog_digest, 'catalog.catalog_digest');
    for (const input of list(raw.entries, 'catalog.entries')) {
      const e = closedRecord(input, ['native_identity', 'unit'], ['native_identity', 'unit'], 'catalog.entry');
      const key = opaqueId(e.native_identity, 'catalog.native_identity');
      const unit = parseRootUnit(e.unit);
      if (this.#entries.has(key) || this.#unitIds.has(unit.unit_id)) throw new IdentityError('E_CONFLICT');
      this.#checkNativeOwners(key, unit.native_refs);
      this.#commit(key, unit);
    }
    if (this.exportState().catalog_digest !== expectedDigest) throw new ContractError('catalog.catalog_digest', 'mapping mismatch');
  }
  #checkNativeOwners(key: string, refs: readonly string[]): void {
    for (const ref of refs) {
      const owner = this.#nativeOwners.get(ref);
      if (owner !== undefined && owner !== key) throw new IdentityError('E_CONFLICT');
    }
  }
  #commit(key: string, unit: RootUnit): void {
    const old = this.#entries.get(key);
    if (old) for (const ref of old.unit.native_refs) this.#nativeOwners.delete(ref);
    for (const ref of unit.native_refs) this.#nativeOwners.set(ref, key);
    this.#unitIds.add(unit.unit_id);
    this.#entries.set(key, Object.freeze({ native_identity: key, unit }));
  }
  observe(input: unknown): RootObservationResult {
    const data = observeInput(input), previous = this.#entries.get(data.native_identity)?.unit;
    this.#checkNativeOwners(data.native_identity, data.native_refs);
    if (!previous && this.#entries.size >= MAX_CATALOG_ROOTS) throw new ContractError('catalog', 'root count limit exceeded');
    const changed = previous !== undefined && hashPayload(material(previous)) !== hashPayload(material(data));
    const revision = previous ? integer(previous.revision + (changed ? 1 : 0), 0, MAX, 'root.revision') : 0;
    const unitId = previous?.unit_id ?? newEntityId();
    if (!previous && this.#unitIds.has(unitId)) throw new IdentityError('E_CONFLICT');
    const partial = { unit_id: unitId, revision, kind: data.kind, authority: data.authority,
      protocol_group: data.protocol_group, completed: data.completed, protected: data.protected,
      native_refs: data.native_refs, source_refs: data.source_refs, payload_digest: data.payload_digest };
    const digest = unitDigest(partial);
    const unit: RootUnit = Object.freeze({ ...partial, unit_digest: digest,
      root_coverage: Object.freeze([Object.freeze({ unit_id: unitId, revision, unit_digest: digest })]),
      payload_ref: data.payload_ref, estimated_tokens: data.estimated_tokens });
    const change = previous === undefined ? 'created' : changed ? 'revised'
      : previous.payload_ref !== unit.payload_ref || previous.estimated_tokens !== unit.estimated_tokens ? 'metadata' : 'unchanged';
    if (change !== 'unchanged') this.#commit(data.native_identity, unit);
    return Object.freeze({ unit: change === 'unchanged' && previous ? previous : unit, change });
  }
  /** Lookups do not initialize a missing root and cannot mix namespaces. */
  lookup(binding: unknown, nativeIdentity: unknown): RootUnit | null {
    assertSessionBinding(this.binding, binding);
    return this.#entries.get(opaqueId(nativeIdentity, 'native_identity'))?.unit ?? null;
  }
  exportState(): RootCatalog {
    const body = { schema_version: 1 as const, binding: this.binding, entries: Object.freeze([...this.#entries.values()]) };
    return Object.freeze({ ...body, catalog_digest: hashPayload(body) });
  }
}
