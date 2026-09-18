/** SPEC-02 configuration contract. No scheduler, filesystem, network or host imports. */
import { boolean, choice, closedRecord, ContractError, fraction, integer } from './validation.ts';

export type RequestedMode = 'complete' | 'assisted';
export type ModelLimits = Readonly<{ context_window: number; output_reserve: number; input_limit: number | null }>;
export type Settings = Readonly<{
  enabled: boolean;
  requested_mode: RequestedMode;
  trigger_ratio: number;
  rearm_ratio: number;
  healthy_input_ceiling: number | null;
  growth_reserve_ratio: number;
  minimum_growth_reserve: number;
  mission_reserve: number;
  recent_groups: number;
  minimum_gain: number;
  minimum_gain_ratio: number;
  new_tokens_ratio: number;
  cooldown_ms: number;
  job_timeout_ms: number;
  maximum_attempts: number;
  max_calls_per_session: number;
  max_input_per_session: number;
  task_trigger: boolean;
}>;
export type ResolvedConfiguration = Readonly<{ settings: Settings; limits: ModelLimits }>;
export const DEFAULT_SETTINGS: Readonly<Omit<Settings, 'max_input_per_session'>> = Object.freeze({
  enabled: false, requested_mode: 'complete', trigger_ratio: 0.5, rearm_ratio: 0.4,
  healthy_input_ceiling: null, growth_reserve_ratio: 0.1, minimum_growth_reserve: 8192,
  mission_reserve: 4096, recent_groups: 2, minimum_gain: 1024, minimum_gain_ratio: 0.02,
  new_tokens_ratio: 0.05, cooldown_ms: 30000, job_timeout_ms: 300000,
  maximum_attempts: 2, max_calls_per_session: 32, task_trigger: false,
});
const MAX = Number.MAX_SAFE_INTEGER;
const KEYS = Object.freeze([...Object.keys(DEFAULT_SETTINGS), 'max_input_per_session']);

/** Profile limits must come from the authorized integration, never a guessed model name. */
export function resolveConfig(overrides: unknown, profile: unknown): ResolvedConfiguration {
  const input = closedRecord(overrides, KEYS, [], 'config');
  const raw = closedRecord(profile, ['context_window', 'output_reserve', 'input_limit'], ['context_window', 'output_reserve'], 'limits');
  const context = integer(raw.context_window, 1, MAX, 'limits.context_window');
  // Explicit zero is distinct from omission. Missing output reserve is rejected above.
  const output = integer(raw.output_reserve, 0, MAX, 'limits.output_reserve');
  if (output >= context) throw new ContractError('limits.output_reserve', 'no input capacity remains');
  const inputLimit = !Object.hasOwn(raw, 'input_limit') || raw.input_limit === null ? null : integer(raw.input_limit, 1, MAX, 'limits.input_limit');
  const value = (key: keyof typeof DEFAULT_SETTINGS): unknown => Object.hasOwn(input, key) ? input[key] : DEFAULT_SETTINGS[key];
  const quota = Object.hasOwn(input, 'max_input_per_session') ? input.max_input_per_session : context * 8;
  const trigger = fraction(value('trigger_ratio'), 0, 1, true, true, 'config.trigger_ratio');
  const rearm = fraction(value('rearm_ratio'), 0, trigger, true, true, 'config.rearm_ratio');
  const ceiling = value('healthy_input_ceiling');
  const settings: Settings = Object.freeze({
    enabled: boolean(value('enabled'), 'config.enabled'),
    requested_mode: choice(value('requested_mode'), ['complete', 'assisted'] as const, 'config.requested_mode'),
    trigger_ratio: trigger, rearm_ratio: rearm,
    healthy_input_ceiling: ceiling === null ? null : integer(ceiling, 1, MAX, 'config.healthy_input_ceiling'),
    growth_reserve_ratio: fraction(value('growth_reserve_ratio'), 0, 0.5, false, false, 'config.growth_reserve_ratio'),
    minimum_growth_reserve: integer(value('minimum_growth_reserve'), 0, MAX, 'config.minimum_growth_reserve'),
    mission_reserve: integer(value('mission_reserve'), 1, MAX, 'config.mission_reserve'),
    recent_groups: integer(value('recent_groups'), 1, MAX, 'config.recent_groups'),
    minimum_gain: integer(value('minimum_gain'), 1, MAX, 'config.minimum_gain'),
    minimum_gain_ratio: fraction(value('minimum_gain_ratio'), 0, 0.5, false, false, 'config.minimum_gain_ratio'),
    new_tokens_ratio: fraction(value('new_tokens_ratio'), 0, 0.5, true, false, 'config.new_tokens_ratio'),
    cooldown_ms: integer(value('cooldown_ms'), 0, MAX, 'config.cooldown_ms'),
    job_timeout_ms: integer(value('job_timeout_ms'), 1000, 1800000, 'config.job_timeout_ms'),
    maximum_attempts: integer(value('maximum_attempts'), 1, 2, 'config.maximum_attempts'),
    max_calls_per_session: integer(value('max_calls_per_session'), 1, MAX, 'config.max_calls_per_session'),
    max_input_per_session: integer(quota, 1, MAX, 'config.max_input_per_session'),
    task_trigger: boolean(value('task_trigger'), 'config.task_trigger'),
  });
  return Object.freeze({ settings, limits: Object.freeze({ context_window: context, output_reserve: output, input_limit: inputLimit }) });
}
