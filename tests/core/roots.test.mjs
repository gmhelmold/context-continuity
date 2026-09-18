import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ContractError, IdentityError, canonical, hashSource, createSessionBinding,
  RootIdentityRegistry, parseRootUnit, parseRootRef, parseSourceRef } from '../../packages/core/src/index.ts';

const scope = { installation_id: '11111111-1111-4111-8111-111111111111', adapter_id: 'opencode',
  workspace_id: '22222222-2222-4222-8222-222222222222', host_session_id: 'session' };
const incarnation = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const source = { source_id: '55555555-5555-4555-8555-555555555555', revision: 0, digest: hashSource(Buffer.from('source')) };
const binding = createSessionBinding(scope, incarnation, 0);
const observation = (id = 'native-1') => ({ native_identity: id, authority: 'agent', protocol_group: 'group-' + id,
  completed: true, protected: false, native_refs: [id], source_refs: [{ ...source }], payload_ref: 'payload-ref',
  payload: { role: 'assistant', content: 'ROOT_PAYLOAD_NOT_IN_SNAPSHOT', metadata: { revision: 1 } }, estimated_tokens: 20 });
const clone = value => JSON.parse(JSON.stringify(value));
const reject = fn => assert.throws(fn, e => e instanceof ContractError && e.code === 'E_SCHEMA');
const conflict = fn => assert.throws(fn, e => e instanceof IdentityError && e.code === 'E_CONFLICT');
const scopeError = fn => assert.throws(fn, e => e instanceof IdentityError && e.code === 'E_SCOPE');
function independentDigest(u) {
  return createHash('sha256').update(canonical({ unit_id: u.unit_id, revision: u.revision, kind: u.kind,
    authority: u.authority, protocol_group: u.protocol_group, completed: u.completed, protected: u.protected,
    native_refs: u.native_refs, source_refs: u.source_refs, payload_digest: u.payload_digest })).digest('hex');
}
function rehash(u) {
  u.unit_digest = independentDigest(u);
  u.root_coverage = [{ unit_id: u.unit_id, revision: u.revision, unit_digest: u.unit_digest }];
  return u;
}

test('T07.contract: first observation creates an immutable root with exactly its own coverage', () => {
  const registry = new RootIdentityRegistry(binding), input = observation();
  const { unit, change } = registry.observe(input);
  assert.equal(change, 'created'); assert.equal(unit.kind, 'root'); assert.equal(unit.revision, 0);
  assert.equal(unit.unit_digest, independentDigest(unit));
  assert.deepEqual(unit.root_coverage, [{ unit_id: unit.unit_id, revision: 0, unit_digest: unit.unit_digest }]);
  assert.deepEqual(parseRootUnit(clone(unit)), unit);
  input.source_refs[0].digest = '0'.repeat(64); input.native_refs[0] = 'changed'; input.payload.metadata.revision = 999;
  assert.equal(unit.source_refs[0].digest, source.digest); assert.deepEqual(unit.native_refs, ['native-1']);
  for (const v of [unit, unit.source_refs, unit.source_refs[0], unit.native_refs, unit.root_coverage, unit.root_coverage[0]]) assert.ok(Object.isFrozen(v));
});

test('T07.contract: repeated observations reuse identity without incrementing revision', () => {
  const registry = new RootIdentityRegistry(binding), input = observation();
  const first = registry.observe(input).unit;
  for (let i = 0; i < 100; i++) {
    const next = registry.observe(clone(input));
    assert.equal(next.change, 'unchanged'); assert.equal(next.unit, first);
  }
  assert.equal(registry.exportState().entries.length, 1);
});

test('T07.contract: equal text with different public identities never coalesces', () => {
  const registry = new RootIdentityRegistry(binding);
  const a = registry.observe(observation('a')).unit, b = registry.observe(observation('b')).unit;
  assert.equal(a.payload_digest, b.payload_digest); assert.notEqual(a.unit_id, b.unit_id); assert.notEqual(a.unit_digest, b.unit_digest);
  assert.equal(registry.exportState().entries.length, 2);
});

test('T07.contract: payload, role, metadata and source changes create monotonic revisions', () => {
  const alterations = [
    o => { o.payload.content += ' changed'; }, o => { o.payload.role = 'user'; },
    o => { o.payload.metadata.revision = 2; }, o => { o.source_refs[0].revision = 1; },
    o => { o.source_refs[0].digest = '0'.repeat(64); }, o => { o.authority = 'user'; },
    o => { o.protocol_group = 'other-group'; }, o => { o.native_refs = ['part-A', 'part-B']; },
    o => { o.completed = false; }, o => { o.protected = true; },
  ];
  for (const alter of alterations) {
    const registry = new RootIdentityRegistry(binding), input = observation(), first = registry.observe(input).unit;
    const changed = clone(input); alter(changed);
    const next = registry.observe(changed);
    assert.equal(next.change, 'revised'); assert.equal(next.unit.unit_id, first.unit_id); assert.equal(next.unit.revision, 1);
    assert.notEqual(next.unit.unit_digest, first.unit_digest); assert.equal(next.unit.unit_digest, independentDigest(next.unit));
    const reverted = registry.observe(input);
    assert.equal(reverted.unit.revision, 2); assert.notEqual(reverted.unit.unit_digest, first.unit_digest);
  }
});

test('T07.contract: a locator or estimate update is not a semantic rewrite', () => {
  const registry = new RootIdentityRegistry(binding), input = observation(), old = registry.observe(input).unit;
  const next = registry.observe({ ...input, payload_ref: 'moved-locator', estimated_tokens: 999 });
  assert.equal(next.change, 'metadata'); assert.equal(next.unit.revision, old.revision); assert.equal(next.unit.unit_digest, old.unit_digest);
  assert.equal(registry.lookup(binding, input.native_identity).payload_ref, 'moved-locator');
  assert.equal(old.payload_ref, 'payload-ref');
});

test('T07.contract: roots lacking source references or complete protocol remain protected', () => {
  for (const changes of [{ source_refs: [] }, { completed: false }, { completed: false, source_refs: [] }]) {
    const registry = new RootIdentityRegistry(binding);
    const unit = registry.observe({ ...observation(), ...changes }).unit;
    assert.equal(unit.protected, true);
    reject(() => parseRootUnit(rehash({ ...clone(unit), protected: false })));
  }
});

test('T07.contract: native groups cannot overlap; conflict does not mutate the registry', () => {
  const registry = new RootIdentityRegistry(binding), a = observation('a'), b = observation('b');
  a.native_refs = ['part-1', 'part-2']; registry.observe(a); const prior = registry.exportState();
  b.native_refs = ['part-2']; conflict(() => registry.observe(b));
  assert.deepEqual(registry.exportState(), prior);
  registry.observe({ ...a, native_refs: ['part-1'] }); registry.observe(b);
  assert.equal(registry.exportState().entries.length, 2);
});

test('T07.contract: immutable export/reload retains IDs, revisions and exact scope without payload copies', () => {
  const registry = new RootIdentityRegistry(binding);
  registry.observe(observation('a')); registry.observe(observation('b'));
  registry.observe({ ...observation('a'), payload: { role: 'assistant', content: 'edited' } });
  const saved = registry.exportState(), restored = new RootIdentityRegistry(binding, clone(saved));
  assert.deepEqual(restored.exportState(), saved);
  assert.deepEqual(restored.lookup(binding, 'a'), registry.lookup(binding, 'a'));
  assert.equal(restored.observe({ ...observation('a'), payload: { role: 'assistant', content: 'edited' } }).change, 'unchanged');
  assert.equal(JSON.stringify(saved).includes('ROOT_PAYLOAD_NOT_IN_SNAPSHOT'), false);
  assert.ok(Object.isFrozen(saved) && Object.isFrozen(saved.entries) && Object.isFrozen(saved.entries[0]));
  restored.observe(observation('c')); assert.equal(saved.entries.length, 2);
  assert.throws(() => { registry.binding = createSessionBinding(scope, other, 0); }, TypeError);
});

test('WP-01/B: identical native IDs cannot cross session, workspace, adapter, incarnation or epoch', () => {
  const bindings = [binding, createSessionBinding({ ...scope, workspace_id: other }, incarnation, 0),
    createSessionBinding({ ...scope, adapter_id: 'other' }, incarnation, 0),
    createSessionBinding({ ...scope, host_session_id: 'other' }, incarnation, 0),
    createSessionBinding(scope, other, 0), createSessionBinding(scope, incarnation, 1)];
  const registries = bindings.map(b => new RootIdentityRegistry(b));
  const units = registries.map(r => r.observe(observation()).unit);
  assert.equal(new Set(units.map(u => u.unit_id)).size, units.length);
  for (let i = 0; i < registries.length; i++) {
    for (let j = 0; j < registries.length; j++) {
      if (i === j) assert.equal(registries[i].lookup(bindings[j], 'native-1'), units[i]);
      else {
        scopeError(() => registries[i].lookup(bindings[j], 'native-1'));
        scopeError(() => new RootIdentityRegistry(bindings[j], registries[i].exportState()));
      }
    }
  }
  assert.equal(registries[0].lookup(binding, 'missing'), null);
  assert.equal(registries[0].exportState().entries.length, 1);
});

test('T07.contract: persisted corruption and ambiguous identity maps fail closed', () => {
  const registry = new RootIdentityRegistry(binding); registry.observe(observation());
  const snapshot = registry.exportState();
  for (const alter of [s => { s.entries[0].unit.payload_digest = '0'.repeat(64); },
    s => { s.entries[0].unit.root_coverage[0].revision++; }, s => { s.entries[0].unit.unit_digest = '0'.repeat(64); },
    s => { s.entries[0].unit.root_coverage.push(clone(s.entries[0].unit.root_coverage[0])); },
    s => { s.schema_version = 2; }, s => { s.entries[0].native_identity = 'swapped-alias'; }, s => { s.extra = true; }]) {
    const copy = clone(snapshot); alter(copy); reject(() => new RootIdentityRegistry(binding, copy));
  }
  const duplicate = clone(snapshot); duplicate.entries.push(clone(duplicate.entries[0]));
  conflict(() => new RootIdentityRegistry(binding, duplicate));
  const sameId = clone(snapshot); sameId.entries.push({ ...clone(sameId.entries[0]), native_identity: 'different' });
  conflict(() => new RootIdentityRegistry(binding, sameId));
});

test('T07.contract: maximum revision is preserved on replay; increment overflow is atomic', () => {
  const registry = new RootIdentityRegistry(binding); registry.observe(observation());
  const state = clone(registry.exportState()); state.entries[0].unit.revision = Number.MAX_SAFE_INTEGER; rehash(state.entries[0].unit);
  const { catalog_digest: _old, ...body } = state;
  state.catalog_digest = createHash('sha256').update(canonical(body)).digest('hex');
  const loaded = new RootIdentityRegistry(binding, state);
  assert.equal(loaded.observe(observation()).change, 'unchanged');
  reject(() => loaded.observe({ ...observation(), payload: { content: 'new' } }));
  assert.deepEqual(loaded.exportState(), state);
});

test('WP-01/B: strict references, dense arrays and observation fields reject ambiguity', () => {
  const registry = new RootIdentityRegistry(binding), valid = registry.observe(observation()).unit;
  assert.deepEqual(parseSourceRef(source), source); assert.deepEqual(parseRootRef(valid.root_coverage[0]), valid.root_coverage[0]);
  for (const ref of [{ ...source, revision: -1 }, { ...source, revision: 0.1 }, { ...source, digest: null }, { ...source, extra: true }]) reject(() => parseSourceRef(ref));
  for (const overrides of [{ native_refs: [] }, { native_refs: ['dup', 'dup'] }, { source_refs: [source, { ...source, digest: '0'.repeat(64) }] },
    { source_refs: [undefined] }, { source_refs: new Array(2) }, { estimated_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { native_identity: '' }, { payload: undefined }, { authority: 'system' }, { completed: 'true' }, { extra: true }]) {
    reject(() => registry.observe({ ...observation(), ...overrides }));
  }
  let invoked = 0; const accessors = []; Object.defineProperty(accessors, '0', { enumerable: true, get() { invoked++; return source; } });
  reject(() => registry.observe({ ...observation(), source_refs: accessors })); assert.equal(invoked, 0);
});

test('T07.contract: 500 roots and repeated JSON reloads preserve identities without cumulative payload snapshots', () => {
  let registry = new RootIdentityRegistry(binding); const ids = [];
  for (let i = 0; i < 500; i++) {
    ids.push(registry.observe(observation('id-' + i)).unit.unit_id);
    if (i % 50 === 0) registry = new RootIdentityRegistry(binding, clone(registry.exportState()));
  }
  assert.deepEqual(registry.exportState().entries.map(e => e.unit.unit_id), ids);
  for (let i = 0; i < 500; i++) assert.equal(registry.observe(observation('id-' + i)).change, 'unchanged');
  assert.equal(registry.exportState().entries.length, 500);
});

test('T07.contract: a fresh Node process restores the serialized registry without issuing new root IDs', () => {
  const registry = new RootIdentityRegistry(binding); const input = observation(); registry.observe(input);
  registry.observe({ ...input, payload: { role: 'assistant', content: 'updated' } });
  const state = registry.exportState();
  const moduleURL = new URL('../../packages/core/src/index.ts', import.meta.url).href;
  const program = `import {readFileSync} from 'node:fs'; import {RootIdentityRegistry} from ${JSON.stringify(moduleURL)};
    const state=JSON.parse(readFileSync(0,'utf8')); const registry=new RootIdentityRegistry(state.binding,state);
    process.stdout.write(JSON.stringify(registry.exportState()));`;
  const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program],
    { input: JSON.stringify(state), encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.deepEqual(JSON.parse(output), state);
});
