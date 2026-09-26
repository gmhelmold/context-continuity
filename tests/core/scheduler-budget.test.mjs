import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError, TriggerBudgetError, deriveTriggerBudget, evaluateTrigger, resolveConfig } from '../../packages/core/src/index.ts';

const config = (overrides = {}, limits = { context_window: 1000000, output_reserve: 16000, input_limit: 900000 }) => resolveConfig(overrides, limits);
const schema = fn => assert.throws(fn, error => error instanceof ContractError && error.code === 'E_SCHEMA');
const budgetError = fn => assert.throws(fn, error => error instanceof TriggerBudgetError && error.code === 'E_BUDGET');

test('T15.budget: SPEC-02 synthetic example has fixed derived limits', () => {
  const actual = evaluateTrigger(config({ healthy_input_ceiling: 650000 }), { effective_input_tokens: 500000 });
  assert.deepEqual(actual, {
    budget: { input_budget: 650000, growth_reserve: 65000, mission_reserve: 4096, trigger_threshold: 500000, rearm_threshold: 400000, new_tokens: 50000, minimum_gain_floor: 10000 },
    effective_input_tokens: 500000,
    eligible: true,
  });
});

test('T15.budget: T-1 is ineligible and T is eligible', () => {
  const resolved = config({ healthy_input_ceiling: 650000 });
  assert.equal(evaluateTrigger(resolved, { effective_input_tokens: 499999 }).eligible, false);
  assert.equal(evaluateTrigger(resolved, { effective_input_tokens: 500000 }).eligible, true);
});

test('T15.budget: null input cap, finite input cap, and healthy cap choose smallest input budget', () => {
  const limits = { context_window: 1000, output_reserve: 100 };
  assert.equal(deriveTriggerBudget(config({ minimum_growth_reserve: 0, mission_reserve: 1 }, limits)).input_budget, 900);
  assert.equal(deriveTriggerBudget(config({ minimum_growth_reserve: 0, mission_reserve: 1 }, { ...limits, input_limit: 800 })).input_budget, 800);
  assert.equal(deriveTriggerBudget(config({ minimum_growth_reserve: 0, mission_reserve: 1, healthy_input_ceiling: 700 }, { ...limits, input_limit: 800 })).input_budget, 700);
});

test('T15.budget: reserves round up while thresholds round down', () => {
  const resolved = config({ growth_reserve_ratio: 0.1, minimum_growth_reserve: 0, mission_reserve: 1 }, { context_window: 101, output_reserve: 0, input_limit: 101 });
  assert.deepEqual(deriveTriggerBudget(resolved), {
    input_budget: 101, growth_reserve: 11, mission_reserve: 1, trigger_threshold: 50, rearm_threshold: 40, new_tokens: 4096, minimum_gain_floor: 1024,
  });
});

test('T15.budget: M varies with U and U has no cache deduction', () => {
  const resolved = config({ minimum_gain: 1, minimum_gain_ratio: 0.02 });
  assert.equal(evaluateTrigger(resolved, { effective_input_tokens: 5000 }).budget.minimum_gain_floor, 100);
  assert.equal(evaluateTrigger(resolved, { effective_input_tokens: 5051 }).budget.minimum_gain_floor, 102);
});

test('T15.budget: input is closed data-only record with safe nonnegative integer', () => {
  const resolved = config();
  for (const input of [null, [], {}, { effective_input_tokens: -1 }, { effective_input_tokens: 1.1 }, { effective_input_tokens: Infinity }, { effective_input_tokens: Number.MAX_SAFE_INTEGER + 1 }, { effective_input_tokens: '1' }, { effective_input_tokens: 1, extra: true }, { [Symbol('hidden')]: true, effective_input_tokens: 1 }, Object.create({ effective_input_tokens: 1 })]) schema(() => evaluateTrigger(resolved, input));
  let called = false;
  schema(() => evaluateTrigger(resolved, { get effective_input_tokens() { called = true; return 1; } }));
  assert.equal(called, false);
  assert.equal(evaluateTrigger(resolved, Object.assign(Object.create(null), { effective_input_tokens: 0 })).effective_input_tokens, 0);
});

test('T15.budget: results are frozen independent aliases', () => {
  const result = evaluateTrigger(config(), { effective_input_tokens: 500000 });
  const another = evaluateTrigger(config(), { effective_input_tokens: 500000 });
  for (const value of [result, result.budget, another.budget]) assert.ok(Object.isFrozen(value));
  assert.notEqual(result.budget, another.budget);
  assert.throws(() => { result.effective_input_tokens = 0; }, TypeError);
  assert.throws(() => { result.budget.trigger_threshold = 0; }, TypeError);
});

test('T15.budget: impossible computed budgets fail E_BUDGET', () => {
  budgetError(() => deriveTriggerBudget(config({ minimum_growth_reserve: 900, mission_reserve: 1 }, { context_window: 1000, output_reserve: 0, input_limit: 900 })));
});
