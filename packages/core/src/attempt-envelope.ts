/** SPEC-02 preflight arithmetic. Pure; does not reserve, dispatch, or retain attempt state. */
import type { ResolvedConfiguration } from './config.ts';
import { closedRecord, integer } from './validation.ts';
import { deriveTriggerBudget, TriggerBudgetError } from './scheduler-budget.ts';

export type AttemptEnvelope = Readonly<{
  input_budget: number;
  output_reserve: number;
  mission_reserve: number;
  mission_reserve_excess: number;
}>;

const MAX = Number.MAX_SAFE_INTEGER;

/** Checks primary and clone request sizes before an attempt can be reserved. */
export function evaluateAttemptEnvelope(config: ResolvedConfiguration, input: unknown): AttemptEnvelope {
  const raw = closedRecord(input, ['primary_input_tokens', 'clone_input_tokens', 'mission_tokens', 'output_tokens'], ['primary_input_tokens', 'clone_input_tokens', 'mission_tokens', 'output_tokens'], 'input');
  const primaryInputTokens = integer(raw.primary_input_tokens, 0, MAX, 'input.primary_input_tokens');
  const cloneInputTokens = integer(raw.clone_input_tokens, 0, MAX, 'input.clone_input_tokens');
  const missionTokens = integer(raw.mission_tokens, 0, MAX, 'input.mission_tokens');
  const outputTokens = integer(raw.output_tokens, 0, MAX, 'input.output_tokens');
  const budget = deriveTriggerBudget(config);
  if (primaryInputTokens > budget.input_budget || cloneInputTokens > budget.input_budget || outputTokens !== config.limits.output_reserve || cloneInputTokens < missionTokens) throw new TriggerBudgetError();
  return Object.freeze({
    input_budget: budget.input_budget,
    output_reserve: config.limits.output_reserve,
    mission_reserve: budget.mission_reserve,
    mission_reserve_excess: Math.max(0, missionTokens - budget.mission_reserve),
  });
}
