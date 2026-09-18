/** JSON terminal capture contract, not a host hook or a publication gate.
 * The adapter must prove its layout describes the final request. Whole JSON bodies
 * and every group payload are bound; no keys outside history are silently excluded. */
import { choice, closedRecord, ContractError, integer } from './validation.ts';
import { assertSessionBinding, hashPayload, newEntityId, opaqueId, parseSessionBinding, parseWorkContext } from './identity.ts';
import type { Scope, SessionBinding, WorkContext } from './identity.ts';
import { MAX_CATALOG_ROOTS, RootIdentityRegistry } from './roots.ts';
import type { RootUnit } from './roots.ts';
import { dataList, distinct, ownJSON } from './contract-data.ts';
import type { JsonValue } from './contract-data.ts';
export type NativeGroupIdentity = Readonly<{ native_identity: string; native_refs: readonly string[] }>;
declare const captureBrand: unique symbol;
declare const sealedBrand: unique symbol;
export type Capture = Readonly<{ capture_id: string; scope: Scope; incarnation: string; host_epoch: number; work: WorkContext;
  native_identity_map: readonly NativeGroupIdentity[]; kind: 'primary' | 'native_compaction' | 'maintenance' | 'other'; [captureBrand]: true }>;
export type JSONFrameLayout = Readonly<{ route_id: string; model_id: string; variant: string | null; history_key: string;
  prefix_length: number; system_keys: readonly string[]; tool_keys: readonly string[];
  groups: readonly Readonly<{ native_identity: string; count: number }>[]; input_estimate: number }>;
export type SealedFrame = Readonly<{ capture: Capture; frame_id: string; roots: readonly RootUnit[];
  system_digest: string; tools_digest: string; config_digest: string; input_digest: string; envelope_digest: string;
  route_id: string; model_id: string; variant: string | null; input_estimate: number; envelope: JsonValue; [sealedBrand]: true }>;
const captures = new WeakMap<object, SessionBinding>();
const frames = new WeakMap<object, SessionBinding>();
export class FrameError extends Error {
  readonly code: 'E_PROTOCOL' | 'E_STALE';
  constructor(code: 'E_PROTOCOL' | 'E_STALE') { super('frame: terminal mapping or payload mismatch'); this.name = 'FrameError'; this.code = code; }
}
function names(input: unknown, field: string): readonly string[] {
  const result = dataList(input, MAX_CATALOG_ROOTS, field).map(x => opaqueId(x, field));
  distinct(result, x => x, field);
  return Object.freeze(result);
}
/** The issuer is the adapter, never model output. A captured ticket is not sealed. */
export function createCapture(binding: unknown, input: unknown): Capture {
  const scope = parseSessionBinding(binding);
  const fields = ['kind', 'work', 'native_identity_map'];
  const v = closedRecord(input, fields, fields, 'capture');
  const map = dataList(v.native_identity_map, MAX_CATALOG_ROOTS, 'capture.map').map(value => {
    const e = closedRecord(value, ['native_identity', 'native_refs'], ['native_identity', 'native_refs'], 'capture.group');
    const refs = names(e.native_refs, 'capture.native_refs');
    if (!refs.length) throw new ContractError('capture.native_refs', 'missing public identity');
    return Object.freeze({ native_identity: opaqueId(e.native_identity), native_refs: refs });
  });
  distinct(map, e => e.native_identity, 'capture.map');
  distinct(map.flatMap(e => [...e.native_refs]), x => x, 'capture.native_refs');
  const result = Object.freeze({ capture_id: newEntityId(), scope: scope.scope, incarnation: scope.incarnation, host_epoch: scope.host_epoch,
    work: parseWorkContext(v.work), native_identity_map: Object.freeze(map),
    kind: choice(v.kind, ['primary', 'native_compaction', 'maintenance', 'other'] as const, 'capture.kind') }) as Capture;
  captures.set(result, scope);
  return result;
}
function ticket(binding: unknown, input: unknown): Capture {
  if (input === null || typeof input !== 'object' || !captures.has(input)) throw new ContractError('capture', 'expected an issued capture');
  assertSessionBinding(binding, captures.get(input));
  return input as Capture;
}
/** Layout partitions exactly one top-level history array. Prefix and all other
 * top-level fields participate in config_digest. Nested/opaque routes are unsupported
 * by this JSON profile, not silently flattened. No registry mutation occurs on seal. */
export function sealFrame(binding: unknown, captureInput: unknown, registry: RootIdentityRegistry, finalRequest: unknown, layoutInput: unknown): SealedFrame {
  const capture = ticket(binding, captureInput);
  if (!(registry instanceof RootIdentityRegistry)) throw new ContractError('registry', 'expected a root registry');
  assertSessionBinding(binding, registry.binding);
  const fields = ['route_id', 'model_id', 'variant', 'history_key', 'prefix_length', 'system_keys', 'tool_keys', 'groups', 'input_estimate'];
  const v = closedRecord(layoutInput, fields, fields, 'layout');
  const route = opaqueId(v.route_id, 'route'), model = opaqueId(v.model_id, 'model');
  const variant = v.variant === null ? null : opaqueId(v.variant, 'variant');
  const historyKey = opaqueId(v.history_key, 'history_key');
  const envelope = ownJSON(finalRequest, 'envelope');
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) throw new FrameError('E_PROTOCOL');
  const body = envelope as Readonly<Record<string, JsonValue>>;
  if (!Object.hasOwn(body, historyKey)) throw new FrameError('E_PROTOCOL');
  const history = dataList(body[historyKey], MAX_CATALOG_ROOTS, 'history') as JsonValue[];
  const prefixLength = integer(v.prefix_length, 0, history.length, 'prefix_length');
  const systemKeys = names(v.system_keys, 'system_keys'), toolKeys = names(v.tool_keys, 'tool_keys');
  for (const key of [...systemKeys, ...toolKeys]) if (key === historyKey || !Object.hasOwn(body, key)) throw new FrameError('E_PROTOCOL');
  distinct([...systemKeys, ...toolKeys], x => x, 'layout.fields');
  const groups = dataList(v.groups, MAX_CATALOG_ROOTS, 'groups');
  if (groups.length !== capture.native_identity_map.length) throw new FrameError('E_PROTOCOL');
  const roots: RootUnit[] = [];
  let at = prefixLength;
  for (let index = 0; index < groups.length; index++) {
    const g = closedRecord(groups[index], ['native_identity', 'count'], ['native_identity', 'count'], 'group');
    const id = opaqueId(g.native_identity), count = integer(g.count, 1, history.length - at, 'group.count');
    const captured = capture.native_identity_map[index];
    if (!captured || captured.native_identity !== id) throw new FrameError('E_PROTOCOL');
    const unit = registry.lookup(binding, id);
    if (!unit || hashPayload(unit.native_refs) !== hashPayload(captured.native_refs)) throw new FrameError('E_STALE');
    if (unit.payload_digest !== hashPayload(history.slice(at, at + count))) throw new FrameError('E_STALE');
    roots.push(unit); at += count;
  }
  if (at !== history.length) throw new FrameError('E_PROTOCOL');
  distinct(roots, r => r.unit_id, 'roots');
  const prefix = history.slice(0, prefixLength);
  const nonhistory = Object.fromEntries(Object.entries(body).filter(([key]) => key !== historyKey));
  const select = (keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, body[key]]));
  const config = hashPayload({ route_id: route, model_id: model, variant, history_key: historyKey, system_keys: systemKeys, tool_keys: toolKeys,
    fields: nonhistory, history_prefix: prefix });
  const envelopeDigest = hashPayload(envelope);
  const result = Object.freeze({ capture, frame_id: newEntityId(), roots: Object.freeze(roots),
    system_digest: hashPayload({ prefix, fields: select(systemKeys) }), tools_digest: hashPayload(select(toolKeys)), config_digest: config,
    input_digest: hashPayload({ config_digest: config, envelope_digest: envelopeDigest, roots: roots.map(r => r.root_coverage[0]) }),
    envelope_digest: envelopeDigest, route_id: route, model_id: model, variant,
    input_estimate: integer(v.input_estimate, 0, Number.MAX_SAFE_INTEGER, 'input_estimate'), envelope }) as SealedFrame;
  frames.set(result, parseSessionBinding(binding));
  return result;
}
/** JSON/checksums copied by a caller cannot upgrade a partial capture into a frame. */
export function assertSealedFrame(binding: unknown, input: unknown): SealedFrame {
  if (input === null || typeof input !== 'object' || !frames.has(input)) throw new ContractError('frame', 'expected an issued sealed frame');
  assertSessionBinding(binding, frames.get(input));
  return input as SealedFrame;
}
/** Last-moment equality check; actual invocation at the transport boundary is WP-06. */
export function assertFrameUnchanged(binding: unknown, frameInput: unknown, currentRequest: unknown): void {
  const frame = assertSealedFrame(binding, frameInput);
  if (hashPayload(currentRequest) !== frame.envelope_digest) throw new FrameError('E_STALE');
}
