/** Fixed reservation-history keys. Collision probes never materialize foreign envelopes. */
import type { DatabaseSync } from 'node:sqlite';

export const sourcePinMetaKey = (id: string): string => `storage.source-pin.v1:${id}`;
export const stagingIntentMetaKey = (id: string): string => `storage.staging-intent.v1:${id}`;

function exists(db: DatabaseSync, key: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM meta WHERE key=? LIMIT 1').get(key));
}

export const hasSourcePinHistory = (db: DatabaseSync, id: string): boolean => exists(db, sourcePinMetaKey(id));
export const hasStagingIntentHistory = (db: DatabaseSync, id: string): boolean => exists(db, stagingIntentMetaKey(id));
