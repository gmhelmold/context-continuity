/** Storage failures never expose SQL, filesystem paths or stored content. */
export type StorageCode = 'E_STORAGE' | 'E_SCOPE' | 'E_CONFLICT' | 'E_OWNER' | 'E_CAPABILITY';
export class StorageError extends Error {
  readonly code: StorageCode;
  readonly reason: string;
  constructor(code: StorageCode, reason: string) {
    super(`storage: ${reason}`);
    this.name = 'StorageError'; this.code = code; this.reason = reason;
  }
}
export function storageFailure(error: unknown): never {
  if (error instanceof StorageError) throw error;
  const detail = error as { code?: unknown; errcode?: unknown } | null;
  if (detail?.code === 'ERR_SQLITE_ERROR' && typeof detail.errcode === 'number' &&
      Number.isSafeInteger(detail.errcode) && [5, 6].includes(detail.errcode & 0xff)) {
    throw new StorageError('E_STORAGE', 'database busy');
  }
  throw new StorageError('E_STORAGE', 'operation failed');
}
