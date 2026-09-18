/** Bounded JSON data helpers; no caller accessors/iterators are executed. */
import { Buffer } from 'node:buffer';
import { canonical } from './canonical.mjs';
import { ContractError } from './validation.ts';
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export function dataList(input: unknown, max: number, field: string): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > max || Reflect.ownKeys(input).length !== input.length + 1) {
    throw new ContractError(field, 'expected a bounded dense data array');
  }
  const out: unknown[] = [];
  for (let i = 0; i < input.length; i++) {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw new ContractError(field, 'expected data elements');
    out.push(d.value as unknown);
  }
  return out;
}
export function distinct<T>(values: readonly T[], key: (v: T) => string | number, field: string): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) throw new ContractError(field, 'duplicate value');
}
export function contentString(input: unknown, maxPoints: number, field: string): string {
  if (typeof input !== 'string' || !input.isWellFormed() || input.length > maxPoints * 2 || !input.trim().length || Array.from(input).length > maxPoints) {
    throw new ContractError(field, 'expected nonblank bounded Unicode text');
  }
  return input; // Validate without trimming or normalizing the returned bytes.
}
export function freezeJSON(value: JsonValue): JsonValue {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) freezeJSON(v);
    Object.freeze(value);
  }
  return value;
}
/** Copies JSON only. Opaque/multimodal envelopes require their own explicit adapter profile. */
export function ownJSON(input: unknown, field: string, maxBytes = 16 * 1024 * 1024): JsonValue {
  try {
    const text = canonical(input);
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('size');
    // Hash canonicalization is not a license to rewrite the in-memory envelope.
    return freezeJSON(structuredClone(input) as JsonValue);
  } catch { throw new ContractError(field, 'expected bounded canonicalizable JSON'); }
}
