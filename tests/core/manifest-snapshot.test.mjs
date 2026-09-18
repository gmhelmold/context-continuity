/** Regression checks of a SINGLE immutable citation snapshot, not provider/permission tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { ContractError, ManifestError, createManifest, parseManifest, verifyManifest, hashPayload } from '../../packages/core/src/index.ts';
import { binding, id, sha, citationFixture } from './context-fixtures.mjs';
const sourceError = fn => assert.throws(fn, e => e instanceof ManifestError && e.code === 'E_SOURCE');
const schemaError = fn => assert.throws(fn, e => e instanceof ContractError && e.code === 'E_SCHEMA');
const select = (record, locator) => ({ entity: record.entity, authority: record.authority,
  range: { start_byte: 0, end_byte: record.bytes?.length ?? 0 }, excerpt_digest: sha(record.bytes ?? new Uint8Array()),
  presented_as: record.bytes === null ? 'reference_only' : 'full', locator });

test('WP-01/C reconciliation: repeated entity resolves exactly once per immutable manifest', () => {
  const f = citationFixture(); let calls = 0;
  const result = createManifest(f.binding, [f.selections[0], { ...f.selections[0], locator: 'second view' }], entity => { calls++; return f.resolver(entity); });
  assert.equal(calls, 1, 'one source version must be loaded once');
  assert.equal(result.manifest.entries.length, 2); assert.equal(result.manifest.entries[0].excerpt_digest, result.manifest.entries[1].excerpt_digest);
});
test('WP-01/C reconciliation: one chapter version cannot yield two contents within a snapshot', () => {
  const f = citationFixture(), first = f.records[2], second = { ...first, bytes: Buffer.from('{"result":"other claim"}') };
  let calls = 0;
  sourceError(() => createManifest(f.binding, [select(first, 'chapter first'), select(second, 'chapter again')], () => (++calls === 1 ? first : second)));
});
test('WP-01/C reconciliation: contradictory source digests or authority for the same version are rejected structurally', () => {
  const f = citationFixture();
  for (const patch of [{ entity: { ...f.selections[0].entity, ref: { ...f.selections[0].entity.ref, digest: sha('different same-version bytes') } } }, { authority: 'user' }]) {
    const entries = [ { ...f.selections[0], index: 1 }, { ...f.selections[0], ...patch, index: 2, locator: 'other location' } ];
    schemaError(() => parseManifest({ schema_version: 1, manifest_id: id(500), entries }));
  }
});
test('WP-01/C reconciliation: a concurrently writable backing buffer is outside the snapshot profile', () => {
  const b = binding(), bytes = new Uint8Array(new SharedArrayBuffer(5)); bytes.set(Buffer.from('hello'));
  const material = { binding: b, entity: { kind: 'source', ref: { source_id: id(510), revision: 0, digest: sha(bytes) } }, authority: 'external', bytes };
  sourceError(() => createManifest(b, [select(material, 'shared')], () => material));
});
test('WP-01/C reconciliation: unique copied materials are subject to an aggregate verification budget', () => {
  const b = binding(), bytes = Buffer.alloc(16 * 1024 * 1024, 65), digest = sha(bytes);
  const records = Array.from({ length: 5 }, (_, n) => ({ binding: b, authority: 'external', bytes,
    entity: { kind: 'source', ref: { source_id: id(600 + n), revision: 0, digest } } }));
  const selections = records.map((r, n) => select(r, 'large:' + n));
  schemaError(() => createManifest(b, selections, e => records.find(r => r.entity.ref.source_id === e.ref.source_id)));
});
test('WP-01/C reconciliation: nullish unavailable materials have a source outcome', () => {
  const f = citationFixture();
  for (const value of [null, undefined]) sourceError(() => createManifest(f.binding, [f.selections[0]], () => value));
});
test('WP-01/C reconciliation: empty captured text stays distinct from unavailable reference-only data', () => {
  const b = binding(), bytes = Buffer.alloc(0), record = { binding: b, bytes, authority: 'external',
    entity: { kind: 'source', ref: { source_id: id(800), revision: 0, digest: sha(bytes) } } };
  const result = createManifest(b, [select(record, 'empty file')], () => record);
  assert.equal(result.manifest.entries[0].presented_as, 'full');
  assert.equal(result.manifest.entries[0].excerpt_digest, sha(bytes));
  const m = verifyManifest(JSON.parse(JSON.stringify(result.manifest)), b, () => record);
  assert.equal(m.digest, hashPayload(result.manifest));
});
