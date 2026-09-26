import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError, TriggerBudgetError, evaluateAttemptEnvelope, resolveConfig } from '../../packages/core/src/index.ts';

const config = (overrides = {}, limits = { context_window: 1000, output_reserve: 100, input_limit: 900 }) => resolveConfig({ minimum_growth_reserve: 0, mission_reserve: 50, ...overrides }, limits);
const input = (overrides = {}) => ({ primary_input_tokens: 900, clone_input_tokens: 900, mission_tokens: 50, output_tokens: 100, ...overrides });
const schema = fn => assert.throws(fn, error => error instanceof ContractError && error.code === 'E_SCHEMA');
const budgetError = fn => assert.throws(fn, error => error instanceof TriggerBudgetError && error.code === 'E_BUDGET');

test('T15.attempt-envelope: fitting primary and clone produce frozen preflight envelope', () => {
  const result = evaluateAttemptEnvelope(config(), input({ mission_tokens: 80, clone_input_tokens: 900 }));
  assert.deepEqual(result, { input_budget: 900, output_reserve: 100, mission_reserve: 50, mission_reserve_excess: 30 });
  assert.ok(Object.isFrozen(result));
  assert.throws(() => { result.input_budget = 0; }, TypeError);
});

test('T15.attempt-envelope: primary and clone input must each fit B', () => {
  budgetError(() => evaluateAttemptEnvelope(config(), input({ primary_input_tokens: 901 })));
  budgetError(() => evaluateAttemptEnvelope(config(), input({ clone_input_tokens: 901 })));
  assert.equal(evaluateAttemptEnvelope(config(), input()).input_budget, 900);
});

test('T15.attempt-envelope: clone output must equal configured R', () => {
  budgetError(() => evaluateAttemptEnvelope(config(), input({ output_tokens: 99 })));
  budgetError(() => evaluateAttemptEnvelope(config(), input({ output_tokens: 101 })));
});

test('T15.attempt-envelope: clone must include complete mission and excess is recorded only when fitting', () => {
  budgetError(() => evaluateAttemptEnvelope(config(), input({ clone_input_tokens: 49, mission_tokens: 50 })));
  assert.equal(evaluateAttemptEnvelope(config(), input({ clone_input_tokens: 50, mission_tokens: 50 })).mission_reserve_excess, 0);
  assert.equal(evaluateAttemptEnvelope(config(), input({ clone_input_tokens: 900, mission_tokens: 0 })).mission_reserve_excess, 0);
  assert.equal(evaluateAttemptEnvelope(config(), input({ clone_input_tokens: 900, mission_tokens: 51 })).mission_reserve_excess, 1);
});

test('T15.attempt-envelope: input is closed data-only record of safe nonnegative integers', () => {
  const resolved = config();
  for (const value of [null, [], {}, { ...input(), extra: true }, { ...input(), mission_tokens: -1 }, { ...input(), output_tokens: 1.1 }, { ...input(), clone_input_tokens: Infinity }, { ...input(), primary_input_tokens: Number.MAX_SAFE_INTEGER + 1 }, { ...input(), output_tokens: '100' }, { [Symbol('hidden')]: true, ...input() }, Object.create(input())]) schema(() => evaluateAttemptEnvelope(resolved, value));
  let called = false;
  schema(() => evaluateAttemptEnvelope(resolved, { ...input(), get mission_tokens() { called = true; return 50; } }));
  assert.equal(called, false);
  assert.deepEqual(evaluateAttemptEnvelope(resolved, Object.assign(Object.create(null), input())), { input_budget: 900, output_reserve: 100, mission_reserve: 50, mission_reserve_excess: 0 });
});
