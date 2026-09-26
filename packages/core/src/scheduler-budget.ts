/** SPEC-02 trigger arithmetic. Pure; does not arm, dispatch, or retain scheduler state. */
import type { ResolvedConfiguration } from './config.ts';
import { closedRecord, integer } from './validation.ts';

export type TriggerBudget = Readonly<{
  input_budget: number;
  growth_reserve: number;
  mission_reserve: number;
  trigger_threshold: number;
  rearm_threshold: number;
  new_tokens: number;
  minimum_gain_floor: number;
}>;

export type TriggerDecision = Readonly<{
  budget: TriggerBudget;
  effective_input_tokens: number;
  eligible: boolean;
}>;

export class TriggerBudgetError extends Error {
  readonly code = 'E_BUDGET' as const;
  constructor() {
    super('trigger budget: insufficient input capacity');
    this.name = 'TriggerBudgetError';
  }
}

const MAX = Number.MAX_SAFE_INTEGER;

/** Derives static trigger limits from one already-resolved configuration. */
export function deriveTriggerBudget(config: ResolvedConfiguration): TriggerBudget {
  const { limits, settings } = config;
  const budget = Math.floor(Math.min(
    limits.input_limit ?? Infinity,
    limits.context_window - limits.output_reserve,
    settings.healthy_input_ceiling ?? Infinity,
  ));
  const growthReserve = Math.max(settings.minimum_growth_reserve, Math.ceil(settings.growth_reserve_ratio * budget));
  const missionReserve = settings.mission_reserve;
  const triggerThreshold = Math.floor(Math.min(settings.trigger_ratio * limits.context_window, budget - growthReserve - missionReserve));
  const rearmThreshold = Math.floor(Math.min(settings.rearm_ratio * limits.context_window, 0.8 * triggerThreshold));
  if (budget <= 0 || triggerThreshold <= 0 || rearmThreshold >= triggerThreshold) throw new TriggerBudgetError();
  return Object.freeze({
    input_budget: budget,
    growth_reserve: growthReserve,
    mission_reserve: missionReserve,
    trigger_threshold: triggerThreshold,
    rearm_threshold: rearmThreshold,
    new_tokens: Math.max(4096, Math.ceil(settings.new_tokens_ratio * limits.context_window)),
    minimum_gain_floor: settings.minimum_gain,
  });
}

/** Validates current assembled input and derives its input-dependent minimum gain. */
export function evaluateTrigger(config: ResolvedConfiguration, input: unknown): TriggerDecision {
  const raw = closedRecord(input, ['effective_input_tokens'], ['effective_input_tokens'], 'input');
  const effectiveInputTokens = integer(raw.effective_input_tokens, 0, MAX, 'input.effective_input_tokens');
  const budget = deriveTriggerBudget(config);
  return Object.freeze({
    budget: Object.freeze({
      ...budget,
      minimum_gain_floor: Math.max(config.settings.minimum_gain, Math.ceil(config.settings.minimum_gain_ratio * effectiveInputTokens)),
    }),
    effective_input_tokens: effectiveInputTokens,
    eligible: effectiveInputTokens >= budget.trigger_threshold,
  });
}
