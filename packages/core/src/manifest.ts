/** SPEC-01 frozen citation manifests. The resolver is an authorized storage boundary,
 * not a model tool. This module performs no filesystem or network operations. */
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { choice, closedRecord, ContractError, integer } from './validation.ts';
import { assertSessionBinding, digestValue, entityId, hashPayload, hashSource, newEntityId, opaqueId, parseSessionBinding } from './identity.ts';
import type { SessionBinding } from './identity.ts';
import { parseSourceRef } from './roots.ts';
import type { Authority, SourceRef } from './roots.ts';
import { contentString, dataList, distinct } from './contract-data.ts';
export type BlockRef = Readonly<{ block_id: string; version: number; digest: string }>;
export type ChapterRef = Readonly<{ chapter_id: string; digest: string }>;
export type EntityRef = Readonly<{ kind: 'source'; ref: SourceRef }> | Readonly<{ kind: 'block'; ref: BlockRef }> | Readonly<{ kind: 'chapter'; ref: ChapterRef }>;
export type ByteRange = Readonly<{ start_byte: number; end_byte: number }>;
export type ManifestEntry = Readonly<{ index: number; entity: EntityRef; authority: Authority; range: ByteRange; excerpt_digest: string; presented_as: 'full' | 'excerpt' | 'reference_only'; locator: string }>;
export type Manifest = Readonly<{ schema_version: 1; manifest_id: string; entries: readonly ManifestEntry[] }>;
export type CitationSelection = Omit<ManifestEntry, 'index'>;
/** Storage attests the entity-to-representation binding for chapters/blocks. Source
 * bytes are additionally checked directly against SourceRef.digest. Null means unavailable. */
export type CitationMaterial = Readonly<{ binding: SessionBinding; entity: EntityRef; authority: Authority; bytes: Uint8Array | null }>;
export type CitationResolver = (entity: EntityRef) => CitationMaterial | null;
declare const verifiedBrand: unique symbol;
export type VerifiedManifest = Readonly<{ binding: SessionBinding; manifest: Manifest; digest: string; [verifiedBrand]: true }>;
const verified = new WeakSet<object>();
export const MAX_MANIFEST_ENTRIES = 1024;
export const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_VERIFICATION_BYTES = 64 * 1024 * 1024;
export class ManifestError extends Error {
  readonly code = 'E_SOURCE' as const;
  constructor() { super('manifest: source, authority or retained byte range does not match'); this.name = 'ManifestError'; }
}
export function parseEntityRef(input: unknown): EntityRef {
  const v = closedRecord(input, ['kind', 'ref'], ['kind', 'ref'], 'entity');
  const kind = choice(v.kind, ['source', 'block', 'chapter'] as const, 'entity.kind');
  if (kind === 'source') return Object.freeze({ kind, ref: parseSourceRef(v.ref) });
  if (kind === 'block') {
    const r = closedRecord(v.ref, ['block_id', 'version', 'digest'], ['block_id', 'version', 'digest'], 'block_ref');
    return Object.freeze({ kind, ref: Object.freeze({ block_id: entityId(r.block_id), version: integer(r.version, 1, Number.MAX_SAFE_INTEGER, 'block.version'), digest: digestValue(r.digest) }) });
  }
  const r = closedRecord(v.ref, ['chapter_id', 'digest'], ['chapter_id', 'digest'], 'chapter_ref');
  return Object.freeze({ kind, ref: Object.freeze({ chapter_id: entityId(r.chapter_id), digest: digestValue(r.digest) }) });
}
export function parseByteRange(input: unknown): ByteRange {
  const r = closedRecord(input, ['start_byte', 'end_byte'], ['start_byte', 'end_byte'], 'range');
  const start = integer(r.start_byte, 0, Number.MAX_SAFE_INTEGER, 'range.start_byte');
  return Object.freeze({ start_byte: start, end_byte: integer(r.end_byte, start, Number.MAX_SAFE_INTEGER, 'range.end_byte') });
}
const ENTRY_FIELDS = ['index', 'entity', 'authority', 'range', 'excerpt_digest', 'presented_as', 'locator'];
function entry(input: unknown): ManifestEntry {
  const r = closedRecord(input, ENTRY_FIELDS, ENTRY_FIELDS, 'manifest.entry');
  const result = Object.freeze({ index: integer(r.index, 1, MAX_MANIFEST_ENTRIES, 'entry.index'), entity: parseEntityRef(r.entity),
    authority: choice(r.authority, ['user', 'host', 'agent', 'external'] as const, 'entry.authority'), range: parseByteRange(r.range),
    excerpt_digest: digestValue(r.excerpt_digest), presented_as: choice(r.presented_as, ['full', 'excerpt', 'reference_only'] as const, 'entry.presented_as'),
    locator: contentString(opaqueId(r.locator, 'entry.locator'), 512, 'entry.locator') });
  if (result.presented_as === 'reference_only' && (result.range.start_byte !== 0 || result.range.end_byte !== 0 || result.excerpt_digest !== hashSource(new Uint8Array()))) {
    throw new ContractError('entry.range', 'reference-only entries use the empty range and digest');
  }
  return result;
}
/** Shape validation is deliberately NOT source verification. */
export function parseManifest(input: unknown): Manifest {
  const v = closedRecord(input, ['schema_version', 'manifest_id', 'entries'], ['schema_version', 'manifest_id', 'entries'], 'manifest');
  integer(v.schema_version, 1, 1, 'manifest.schema_version');
  const entries = dataList(v.entries, MAX_MANIFEST_ENTRIES, 'manifest.entries').map(entry);
  if (entries.some((e, i) => e.index !== i + 1)) throw new ContractError('manifest.entries', 'indices must be contiguous and ordered');
  distinct(entries, e => e.locator, 'manifest.locators');
  // A version identifies one content/authority definition throughout the snapshot.
  const versions = new Map<string, string>();
  for (const e of entries) {
    const ref = e.entity;
    const coordinate = ref.kind === 'source' ? `source:${ref.ref.source_id}:${ref.ref.revision}`
      : ref.kind === 'block' ? `block:${ref.ref.block_id}:${ref.ref.version}` : `chapter:${ref.ref.chapter_id}`;
    const definition = `${ref.ref.digest}:${e.authority}`;
    if (versions.has(coordinate) && versions.get(coordinate) !== definition) throw new ContractError('manifest.entity', 'contradictory version definition');
    versions.set(coordinate, definition);
  }
  const result = Object.freeze({ schema_version: 1 as const, manifest_id: entityId(v.manifest_id), entries: Object.freeze(entries) });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_MANIFEST_BYTES) throw new ContractError('manifest', 'byte limit exceeded');
  return result;
}
/** Scope, authority and the UTF-8 slice are checked for EVERY entry, not just cited ones.
 * Resolver failures are sanitized. Bytes are never retained in the returned capability. */
export function verifyManifest(input: unknown, binding: unknown, resolve: CitationResolver): VerifiedManifest {
  const manifest = parseManifest(input), scope = parseSessionBinding(binding);
  if (typeof resolve !== 'function') throw new ContractError('resolver', 'expected an authorized resolver');
  type Resolved = { authority: Authority; bytes: Buffer | null; digest: string | null; textual: boolean };
  const resolved = new Map<string, Resolved>();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let totalBytes = 0;
  for (const e of manifest.entries) {
    const key = hashPayload(e.entity);
    let retained = resolved.get(key);
    if (!retained) {
      let material: CitationMaterial | null;
      try { material = resolve(e.entity); } catch { throw new ManifestError(); }
      if (material === null || material === undefined) throw new ManifestError();
      const m = closedRecord(material, ['binding', 'entity', 'authority', 'bytes'], ['binding', 'entity', 'authority', 'bytes'], 'material');
      assertSessionBinding(scope, m.binding);
      if (hashPayload(parseEntityRef(m.entity)) !== key || m.authority !== e.authority) throw new ManifestError();
      let bytes: Buffer | null = null, digest: string | null = null, textual = false;
      if (m.bytes !== null) {
        if (!(m.bytes instanceof Uint8Array) || !(m.bytes.buffer instanceof ArrayBuffer) || m.bytes.byteLength > MAX_SOURCE_BYTES) throw new ManifestError();
        if (totalBytes + m.bytes.byteLength > MAX_VERIFICATION_BYTES) throw new ContractError('manifest.material', 'aggregate verification byte limit exceeded');
        bytes = Buffer.from(m.bytes); totalBytes += bytes.byteLength;
        digest = hashSource(bytes);
        if (e.entity.kind === 'source' && digest !== e.entity.ref.digest) throw new ManifestError();
        try { decoder.decode(bytes); textual = true; } catch { /* Binary can only be reference-only. */ }
      }
      retained = { authority: e.authority, bytes, digest, textual };
      resolved.set(key, retained);
    }
    if (retained.authority !== e.authority) throw new ManifestError();
    if (e.presented_as === 'reference_only') continue;
    const { bytes, textual } = retained;
    if (bytes === null || !textual) throw new ManifestError();
    const { start_byte: start, end_byte: end } = e.range;
    if (end > bytes.length || (e.presented_as === 'full' && (start !== 0 || end !== bytes.length))) throw new ManifestError();
    // With the complete UTF-8 representation already checked once, a cut may
    // point to EOF or a leading byte, never into a continuation byte.
    const boundary = (at: number): boolean => at === bytes.length || ((bytes[at] ?? 0) & 0xc0) !== 0x80;
    if (!boundary(start) || !boundary(end)) throw new ManifestError();
    const excerptDigest = start === 0 && end === bytes.length ? retained.digest : hashSource(bytes.subarray(start, end));
    if (excerptDigest !== e.excerpt_digest) throw new ManifestError();
  }
  const result = Object.freeze({ binding: scope, manifest, digest: hashPayload(manifest) }) as VerifiedManifest;
  verified.add(result);
  return result;
}
/** Caller supplies explicit selections. The core issues the ID and freezes order. */
export function createManifest(binding: unknown, selections: unknown, resolve: CitationResolver): VerifiedManifest {
  const entries = dataList(selections, MAX_MANIFEST_ENTRIES, 'selections').map((s, i) => {
    const fields = ENTRY_FIELDS.filter(k => k !== 'index');
    return { ...closedRecord(s, fields, fields, 'selection'), index: i + 1 };
  });
  return verifyManifest({ schema_version: 1, manifest_id: newEntityId(), entries }, binding, resolve);
}
/** A deserialized manifest must be reverified; its JSON or checksum is not authority. */
export function assertVerifiedManifest(binding: unknown, value: unknown): VerifiedManifest {
  if (value === null || typeof value !== 'object' || !verified.has(value)) throw new ContractError('manifest', 'expected a source-verified manifest');
  const result = value as VerifiedManifest;
  assertSessionBinding(binding, result.binding);
  return result;
}
