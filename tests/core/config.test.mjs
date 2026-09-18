import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError, DEFAULT_SETTINGS, resolveConfig } from '../../packages/core/src/index.ts';

const limits = { context_window: 1000000, output_reserve: 16000, input_limit: 900000 };
const rejects = fn => assert.throws(fn, error => error instanceof ContractError && error.code === 'E_SCHEMA');

// Expected values are fixed from SPEC-02, not calculated by the implementation.
test('T15.contract: all declared defaults resolve without enabling maintenance', () => {
  const actual = resolveConfig({}, limits);
  assert.deepEqual(actual.settings, {
    enabled: false, requested_mode: 'complete', trigger_ratio: 0.5, rearm_ratio: 0.4,
    healthy_input_ceiling: null, growth_reserve_ratio: 0.1, minimum_growth_reserve: 8192,
    mission_reserve: 4096, recent_groups: 2, minimum_gain: 1024, minimum_gain_ratio: 0.02,
    new_tokens_ratio: 0.05, cooldown_ms: 30000, job_timeout_ms: 300000,
    maximum_attempts: 2, max_calls_per_session: 32, max_input_per_session: 8000000, task_trigger: false,
  });
  assert.deepEqual(actual.limits, limits);
});

const domains = [
  ['enabled', [false, true], [0, 1, 'true', null]],
  ['task_trigger', [false, true], [0, 1, 'false', null]],
  ['requested_mode', ['complete', 'assisted'], ['auto', '', null, true]],
  ['trigger_ratio', [0.5, 0.99], [0, 1, -0.1, Infinity, NaN, '0.5']],
  ['rearm_ratio', [0.01, 0.49], [0, 0.5, 1, Infinity, NaN, '0.4']],
  ['healthy_input_ceiling', [null, 1, 700000], [0, -1, 1.1, Infinity, '700000']],
  ['growth_reserve_ratio', [0, 0.5], [-0.1, 0.50001, Infinity, NaN, '0.1']],
  ['minimum_growth_reserve', [0, 1, 8192], [-1, 0.1, Infinity, '8192']],
  ['mission_reserve', [1, 4096], [0, -1, 1.1, Infinity, '4096']],
  ['recent_groups', [1, 2], [0, -1, 1.1, '2']],
  ['minimum_gain', [1, 1024], [0, -1, 1.1, '1024']],
  ['minimum_gain_ratio', [0, 0.5], [-0.1, 0.50001, Infinity, NaN, '0.02']],
  ['new_tokens_ratio', [0.00001, 0.5], [0, -0.1, 0.50001, Infinity, NaN, '0.05']],
  ['cooldown_ms', [0, 30000], [-1, 0.1, Infinity, '30000']],
  ['job_timeout_ms', [1000, 1800000], [999, 1800001, 1000.1, Infinity, '300000']],
  ['maximum_attempts', [1, 2], [0, 3, 1.1, Infinity, '2']],
  ['max_calls_per_session', [1, 32], [0, -1, 1.1, Infinity, '32']],
  ['max_input_per_session', [1, 8000000], [0, -1, 1.1, Infinity, '8000000']],
];
for (const [field, valid, invalid] of domains) {
  test(`T15.contract: ${field} boundaries are strict`, () => {
    for (const value of valid) assert.equal(resolveConfig({ [field]: value }, limits).settings[field], value);
    for (const value of [...invalid, undefined, {}, [], 1n]) rejects(() => resolveConfig({ [field]: value }, limits));
  });
}

test('T15.contract: changed trigger requires a compatible rearm value', () => {
  rejects(() => resolveConfig({ trigger_ratio: 0.3 }, limits));
  assert.equal(resolveConfig({ trigger_ratio: 0.3, rearm_ratio: 0.2 }, limits).settings.rearm_ratio, 0.2);
});

test('T15.contract: no default silently substitutes missing model limits', () => {
  for (const profile of [null, {}, { context_window: 1000 }, { output_reserve: 10 }, { ...limits, output_reserve: undefined }]) {
    rejects(() => resolveConfig({}, profile));
  }
  assert.equal(resolveConfig({}, { context_window: 1000, output_reserve: 0 }).limits.output_reserve, 0);
  assert.equal(resolveConfig({}, { context_window: 1000, output_reserve: 10 }).limits.input_limit, null);
});

test('T15.contract: profile domains, no capacity and unknown fields are rejected', () => {
  for (const value of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1000000']) {
    rejects(() => resolveConfig({}, { ...limits, context_window: value }));
    rejects(() => resolveConfig({}, { ...limits, input_limit: value }));
  }
  for (const value of [-1, 1.5, Infinity, NaN, 1000000, 1000001, '16000']) {
    rejects(() => resolveConfig({}, { ...limits, output_reserve: value }));
  }
  rejects(() => resolveConfig({}, { ...limits, input_limit: undefined }));
  rejects(() => resolveConfig({}, { ...limits, guessed_model: 'anything' }));
});

test('T15.contract: derived quota overflow is rejected; explicit bounded quota is preserved', () => {
  const large = { context_window: Number.MAX_SAFE_INTEGER, output_reserve: 1 };
  rejects(() => resolveConfig({}, large));
  assert.equal(resolveConfig({ max_input_per_session: 1234 }, large).settings.max_input_per_session, 1234);
});

test('T15.contract: controls serialize and resolve identically without mutable aliases', () => {
  const input = { enabled: true, healthy_input_ceiling: 650000 };
  const profile = { ...limits };
  const resolved = resolveConfig(input, profile);
  input.enabled = false; profile.context_window = 100;
  assert.equal(resolved.settings.enabled, true);
  assert.equal(resolved.limits.context_window, 1000000);
  assert.deepEqual(resolveConfig(JSON.parse(JSON.stringify(resolved.settings)), resolved.limits), resolved);
  for (const target of [resolved, resolved.settings, resolved.limits, DEFAULT_SETTINGS]) assert.ok(Object.isFrozen(target));
  assert.throws(() => { resolved.settings.enabled = false; }, TypeError);
});

test('T15.contract: unknown fields, accessors and prototypes are rejected without invocation', () => {
  for (const input of [undefined, null, [], 'text', new Date(), Object.create({ enabled: true }), { secrets: 'DO_NOT_ECHO_ME' }]) {
    rejects(() => resolveConfig(input, limits));
  }
  let called = false;
  rejects(() => resolveConfig({ get enabled() { called = true; return true; } }, limits));
  assert.equal(called, false);
  rejects(() => resolveConfig({ [Symbol('hidden')]: true }, limits));
  rejects(() => resolveConfig(Object.defineProperty({}, 'enabled', { value: true }), limits));
  rejects(() => resolveConfig(JSON.parse('{"__proto__":{"enabled":true}}'), limits));
  assert.throws(() => resolveConfig({ secrets: 'DO_NOT_ECHO_ME' }, limits), error => !error.message.includes('DO_NOT_ECHO_ME'));
  assert.equal(resolveConfig(Object.assign(Object.create(null), { enabled: true }), limits).settings.enabled, true);
});
