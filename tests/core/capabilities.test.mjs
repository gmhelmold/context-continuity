import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError, REQUIRED_CAPABILITIES, decideMode } from '../../packages/core/src/index.ts';

// Independent normative list prevents a missing implementation field becoming a false PASS.
const required = ['identity', 'root_mapping', 'final_capture', 'final_veto', 'substitution',
  'source_retention', 'reset_detection', 'isolated_auxiliary', 'physical_attempt_admission',
  'cancellation_local', 'protocol_validation', 'safe_handoff'];
const complete = () => ({ required: Object.fromEntries(required.map(key => [key, 'verified'])), fidelity: 'verified', runtime_gate: 'pass', reading: 'verified' });
const request = { enabled: true, requested_mode: 'complete', assisted_consent: false };
const rejects = fn => assert.throws(fn, error => error instanceof ContractError && error.code === 'E_SCHEMA');

test('T33.capabilities: complete predicate has exactly twelve named obligations', () => {
  assert.deepEqual(REQUIRED_CAPABILITIES, required);
  assert.ok(Object.isFrozen(REQUIRED_CAPABILITIES));
  assert.deepEqual(decideMode(complete(), request), { allowed: true, mode: 'complete', blockers: [] });
});

for (const field of required) {
  for (const state of ['declared', 'missing', 'unknown', 'omitted']) {
    test(`T33.capabilities: ${field}=${state} never authorizes complete`, () => {
      const evidence = complete();
      if (state === 'omitted') delete evidence.required[field]; else evidence.required[field] = state;
      const decision = decideMode(evidence, request);
      assert.equal(decision.allowed, false);
      assert.equal(decision.mode, 'unsupported');
      assert.deepEqual(decision.blockers, [`capability:${field}`]);
    });
  }
}

test('T33.capabilities: missing report, fidelity and runtime gate fail closed', () => {
  assert.equal(decideMode({}, request).allowed, false);
  for (const [field, invalid] of [['fidelity', ['unverified', 'different']], ['runtime_gate', ['not_run', 'fail', 'blocked']]]) {
    for (const value of [...invalid, 'omitted']) {
      const evidence = complete();
      if (value === 'omitted') delete evidence[field]; else evidence[field] = value;
      assert.equal(decideMode(evidence, request).allowed, false);
    }
  }
});

test('T33.capabilities: cache hit cannot grant authority and cache miss cannot remove it', () => {
  for (const cache of ['hit', 'miss', 'unknown']) {
    assert.equal(decideMode({ ...complete(), cache }, request).allowed, true);
    assert.equal(decideMode({ ...complete(), fidelity: 'unverified', cache }, request).allowed, false);
    assert.equal(decideMode({ ...complete(), runtime_gate: 'not_run', cache }, request).allowed, false);
  }
});

test('T33.capabilities: complete request never silently falls back to assisted', () => {
  const evidence = { required: { source_retention: 'verified' }, reading: 'verified' };
  assert.equal(decideMode(evidence, { ...request, assisted_consent: true }).mode, 'unsupported');
  assert.equal(decideMode(evidence, { ...request, requested_mode: 'assisted', assisted_consent: true }).mode, 'assisted');
  assert.equal(decideMode(evidence, { ...request, requested_mode: 'assisted' }).allowed, false);
});

test('T33.capabilities: assisted needs both retention and reading, even with consent', () => {
  const control = { ...request, requested_mode: 'assisted', assisted_consent: true };
  for (const state of ['unknown', 'missing', 'declared']) {
    assert.equal(decideMode({ required: { source_retention: state }, reading: 'verified' }, control).allowed, false);
    assert.equal(decideMode({ required: { source_retention: 'verified' }, reading: state }, control).allowed, false);
  }
});

test('T33.capabilities: disabled means no mode, independent of supplied certification', () => {
  for (const mode of ['complete', 'assisted']) {
    const decision = decideMode(complete(), { enabled: false, requested_mode: mode, assisted_consent: true });
    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.blockers, ['disabled']);
  }
});

test('T33.capabilities: strict shape, no truthy coercion and no getter execution', () => {
  for (const evidence of [null, [], { required: { invented: 'verified' } }, { ...complete(), fidelity: true }, { ...complete(), runtime_gate: 'success' }, { required: undefined }, { ...complete(), cache: 'free' }]) rejects(() => decideMode(evidence, request));
  for (const control of [{ ...request, enabled: 1 }, { ...request, assisted_consent: 'true' }, { ...request, requested_mode: 'auto' }, { enabled: true }, { ...request, force: true }]) rejects(() => decideMode(complete(), control));
  let invoked = false;
  rejects(() => decideMode({ get required() { invoked = true; return {}; } }, request));
  assert.equal(invoked, false);
});

test('T33.capabilities: output is immutable and decisions do not mutate inputs', () => {
  const evidence = complete(); const before = structuredClone(evidence);
  const decision = decideMode(evidence, request);
  assert.deepEqual(evidence, before);
  assert.ok(Object.isFrozen(decision)); assert.ok(Object.isFrozen(decision.blockers));
  assert.throws(() => decision.blockers.push('new'), TypeError);
});

test('T33.capabilities: deterministic generated combinations match the normative conjunction', () => {
  let seed = 712;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 2000; trial++) {
    const evidence = complete();
    const states = ['verified', 'declared', 'missing', 'unknown'];
    for (const key of required) if (random(8) === 0) evidence.required[key] = states[random(4)];
    evidence.fidelity = ['verified', 'unverified', 'different'][random(3)];
    evidence.runtime_gate = ['pass', 'not_run', 'fail', 'blocked'][random(4)];
    const expected = required.every(key => evidence.required[key] === 'verified') && evidence.fidelity === 'verified' && evidence.runtime_gate === 'pass';
    assert.equal(decideMode(evidence, request).allowed, expected);
  }
});
