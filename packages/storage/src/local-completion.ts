/** SPEC-20: in-process evidence of native Promise settlement, not process death. */
import { types } from 'node:util';
import { hashPayload } from '../../core/src/identity.ts';
import type { AttemptOwnership } from './attempt-owner.ts';
import { StorageError } from './errors.ts';

declare const observationBrand: unique symbol;
export type LocalStopObservation = Readonly<{ ownership_digest: string; [observationBrand]: true }>;
export type ObservedCompletion = Readonly<{ fulfilled: boolean; value: unknown; observation: LocalStopObservation }>;
const observations = new WeakMap<object, string>();
const nativeThen = Promise.prototype.then;

/** Capture identity before waiting. No arbitrary thenable or overridden .then is invoked. */
export function observeLocalCompletion(ownership: AttemptOwnership, pending: unknown): Promise<ObservedCompletion> {
  if (!types.isPromise(pending)) throw new StorageError('E_CAPABILITY', 'native completion Promise required');
  const digest = hashPayload(ownership);
  return new Promise<ObservedCompletion>(resolve => {
    const settled = (fulfilled: boolean, value: unknown): void => {
      const observation = Object.freeze({ ownership_digest: digest }) as LocalStopObservation;
      observations.set(observation, digest);
      // Wrapping the value prevents Promise resolution from assimilating the adapter result.
      resolve(Object.freeze({ fulfilled, value, observation }));
    };
    nativeThen.call(pending, (value: unknown) => settled(true, value), () => settled(false, undefined));
  });
}

/** Only an issued observation for this exact reservation may be persisted. */
export function assertLocalCompletion(ownership: AttemptOwnership, input: unknown): LocalStopObservation {
  if (input === null || typeof input !== 'object' || observations.get(input) !== hashPayload(ownership)) {
    throw new StorageError('E_OWNER', 'local completion observation missing or mismatched');
  }
  return input as LocalStopObservation;
}
