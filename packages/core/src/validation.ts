/** Pure validators. Errors never include caller-controlled values. */
export class ContractError extends Error {
  readonly code = 'E_SCHEMA' as const;
  readonly field: string;
  constructor(field: string, detail: string) {
    super(`${field}: ${detail}`);
    this.name = 'ContractError';
    this.field = field;
  }
}

export function closedRecord(input: unknown, allowed: readonly string[], required: readonly string[], field: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ContractError(field, 'expected a plain object');
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new ContractError(field, 'expected a plain object');
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new ContractError(field, 'unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new ContractError(field, 'expected enumerable data fields');
    result[key] = descriptor.value as unknown;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) throw new ContractError(field, 'missing required field');
  return result;
}

export function integer(input: unknown, min: number, max: number, field: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) throw new ContractError(field, 'expected a safe integer within declared bounds');
  return Object.is(input, -0) ? 0 : input;
}

export function fraction(input: unknown, min: number, max: number, openMin: boolean, openMax: boolean, field: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || (openMin ? input <= min : input < min) || (openMax ? input >= max : input > max)) throw new ContractError(field, 'expected a finite fraction within declared bounds');
  return Object.is(input, -0) ? 0 : input;
}

export function boolean(input: unknown, field: string): boolean {
  if (typeof input !== 'boolean') throw new ContractError(field, 'expected a boolean');
  return input;
}

export function choice<const T extends readonly string[]>(input: unknown, values: T, field: string): T[number] {
  if (typeof input !== 'string' || !values.includes(input)) throw new ContractError(field, 'unknown value');
  return input as T[number];
}
