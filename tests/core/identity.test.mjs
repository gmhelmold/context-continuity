import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonical, parseJSON, ContractError, IdentityError, newEntityId, hashSource, hashPayload,
  parseScope, sessionKey, createSessionBinding, parseSessionBinding, assertSessionBinding,
  parseWorkContext, parseToolExecutionRef, toolExecutionKey } from '../../packages/core/src/index.ts';

const installation = '11111111-1111-4111-8111-111111111111';
const workspace = '22222222-2222-4222-8222-222222222222';
const incarnation = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const scope = { installation_id: installation, adapter_id: 'opencode', workspace_id: workspace, host_session_id: 'same-id' };
const binding = createSessionBinding(scope, incarnation, 0);
const reject = fn => assert.throws(fn, e => e instanceof ContractError && e.code === 'E_SCHEMA');
const scopeError = fn => assert.throws(fn, e => e instanceof IdentityError && e.code === 'E_SCOPE');

test('WP-01/B: Scope has a fixed canonical key and owns immutable copies', () => {
  const text = '{"adapter_id":"opencode","host_session_id":"same-id","installation_id":"11111111-1111-4111-8111-111111111111","workspace_id":"22222222-2222-4222-8222-222222222222"}';
  assert.equal(sessionKey(scope), createHash('sha256').update(text).digest('hex'));
  const input = { ...scope }, result = parseScope(input);
  input.adapter_id = 'changed';
  assert.deepEqual(result, scope);
  assert.ok(Object.isFrozen(result));
  assert.equal(sessionKey({ host_session_id: 'same-id', workspace_id: workspace, adapter_id: 'opencode', installation_id: installation }), sessionKey(scope));
});

test('WP-01/B: repeated external session IDs stay separate across every Scope coordinate', () => {
  const keys = [scope, { ...scope, installation_id: other }, { ...scope, workspace_id: other },
    { ...scope, adapter_id: 'other-harness' }, { ...scope, host_session_id: 'other-session' }].map(sessionKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('WP-01/B: external IDs are byte-bounded and never normalized', () => {
  for (const id of [' ', '\u0000', '__proto__', 'é', 'e\u0301', '🔥'.repeat(128), 'x'.repeat(512)]) {
    assert.equal(parseScope({ ...scope, host_session_id: id }).host_session_id, id);
  }
  assert.notEqual(sessionKey({ ...scope, host_session_id: 'é' }), sessionKey({ ...scope, host_session_id: 'e\u0301' }));
  for (const id of ['', 'x'.repeat(513), '🔥'.repeat(129), '\ud800', null, undefined, 4]) {
    reject(() => parseScope({ ...scope, host_session_id: id }));
  }
});

test('WP-01/B: internal IDs are generated UUIDs, not arbitrary model strings', () => {
  const ids = Array.from({ length: 128 }, newEntityId);
  assert.equal(new Set(ids).size, 128);
  for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/);
  for (const id of ['model-invented', '', '00000000-0000-0000-0000-000000000000', installation.toUpperCase().replace('1', 'A')]) {
    reject(() => parseScope({ ...scope, installation_id: id }));
  }
  assert.equal(parseScope({ ...scope, workspace_id: '01890f47-8c3e-7b67-98a5-431ab01de953' }).workspace_id, '01890f47-8c3e-7b67-98a5-431ab01de953');
});

test('WP-01/B: binding persists but incarnation and epoch must match explicitly', () => {
  assert.deepEqual(parseSessionBinding(JSON.parse(JSON.stringify(binding))), binding);
  assertSessionBinding(binding, binding);
  for (const next of [createSessionBinding({ ...scope, adapter_id: 'gemini' }, incarnation, 0),
    createSessionBinding(scope, other, 0), createSessionBinding(scope, incarnation, 1)]) {
    scopeError(() => assertSessionBinding(binding, next));
  }
  scopeError(() => parseSessionBinding({ ...binding, session_key: '0'.repeat(64) }));
  reject(() => parseSessionBinding({ ...binding, schema_version: 2 }));
  reject(() => parseSessionBinding({ ...binding, authorized: true }));
  for (const epoch of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined]) reject(() => createSessionBinding(scope, incarnation, epoch));
  assert.equal(createSessionBinding(scope, incarnation, Number.MAX_SAFE_INTEGER).host_epoch, Number.MAX_SAFE_INTEGER);
  assert.ok(Object.isFrozen(binding) && Object.isFrozen(binding.scope));
});

test('WP-01/B: WorkContext cannot infer unknown task/phase or accept hidden scope fields', () => {
  assert.deepEqual(parseWorkContext({ task_id: null, phase_id: null }), { task_id: null, phase_id: null });
  assert.deepEqual(parseWorkContext({ task_id: 'A', phase_id: 'B' }), { task_id: 'A', phase_id: 'B' });
  for (const value of [null, {}, { task_id: 'A' }, { task_id: undefined, phase_id: null }, { task_id: null, phase_id: null, session_id: 'other' }]) reject(() => parseWorkContext(value));
});

test('WP-01/B: tool execution keys include message, epoch and incarnation, never content', () => {
  const execution = { host_epoch: 0, host_message_id: 'm', tool_call_id: 'same' };
  assert.deepEqual(parseToolExecutionRef(execution), execution);
  assert.equal(toolExecutionKey(binding, execution), toolExecutionKey(JSON.parse(JSON.stringify(binding)), execution));
  const keys = [toolExecutionKey(binding, execution), toolExecutionKey(binding, { ...execution, host_message_id: 'm2' }),
    toolExecutionKey(binding, { ...execution, tool_call_id: 'other' }), toolExecutionKey(createSessionBinding(scope, other, 0), execution),
    toolExecutionKey(createSessionBinding(scope, incarnation, 1), { ...execution, host_epoch: 1 })];
  assert.equal(new Set(keys).size, keys.length);
  scopeError(() => toolExecutionKey(binding, { ...execution, host_epoch: 1 }));
  reject(() => parseToolExecutionRef({ ...execution, text: 'same text' }));
});

test('WP-01/B: source hash uses literal bytes, effective payload hash includes all JSON fields', () => {
  assert.equal(hashSource(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hashSource(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const forms = ['line\n', 'line\r\n', 'é', 'e\u0301'].map(x => hashSource(Buffer.from(x)));
  assert.equal(new Set(forms).size, 4);
  reject(() => hashSource('abc'));
  const payload = { role: 'assistant', content: 'same', metadata: { version: 1 }, tool_calls: [] };
  const original = hashPayload(payload);
  for (const next of [{ ...payload, role: 'user' }, { ...payload, metadata: { version: 2 } },
    { ...payload, content: 'same ' }, { ...payload, extra: true }, { ...payload, tool_calls: [{ id: 'different' }] }]) assert.notEqual(original, hashPayload(next));
  assert.equal(hashPayload({ a: 1, b: 2 }), hashPayload({ b: 2, a: 1 }));
  assert.notEqual(hashPayload([1, 2]), hashPayload([2, 1]));
});

test('WP-01/B: shared canonical implementation keeps all fixed JCS vectors', () => {
  const vectors = JSON.parse(readFileSync(new URL('../../scripts/canonical-vectors.json', import.meta.url), 'utf8'));
  for (const v of vectors.valid) assert.equal(canonical(parseJSON(v.input)), v.expected);
  for (const v of vectors.invalid) assert.throws(() => parseJSON(v));
});

test('WP-01/B: no accessor/toJSON/iterator invocation and no invisible JSON data loss', () => {
  let invoked = 0;
  const getter = { get value() { invoked++; return 1; } };
  const arrayGetter = []; Object.defineProperty(arrayGetter, '0', { enumerable: true, get() { invoked++; return 1; } });
  const iterator = [1]; iterator[Symbol.iterator] = () => { invoked++; return [][Symbol.iterator](); };
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  const arrayHidden = Object.defineProperty([1], 'hidden', { value: 1 });
  const cycle = {}; cycle.self = cycle;
  for (const value of [getter, arrayGetter, iterator, hidden, arrayHidden, cycle, [,,], { toJSON() { invoked++; return {}; } }, new Date(), new Map(), undefined, 1n, NaN, '\ud800', [1, undefined]]) reject(() => hashPayload(value));
  assert.equal(invoked, 0);
  reject(() => parseScope({ ...scope, get workspace_id() { invoked++; return workspace; } }));
  assert.equal(invoked, 0);
});

test('WP-01/B: errors do not echo sensitive caller values', () => {
  const secret = 'DO_NOT_ECHO_SECRET';
  for (const fn of [() => parseScope({ ...scope, unexpected: secret }), () => createSessionBinding(scope, secret, 0),
    () => parseWorkContext({ task_id: null, phase_id: null, [secret]: true })]) {
    assert.throws(fn, e => e instanceof ContractError && !e.message.includes(secret));
  }
});
