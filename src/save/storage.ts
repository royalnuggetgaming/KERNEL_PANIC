/**
 * KeyValueStorage over localStorage (or any StorageLike) with try/catch everywhere. Falls back to an
 * in-memory map when storage is missing or unusable (private mode, SecurityError). Write failures surface as
 * StorageWriteError so SaveStore can tell a quota problem ('quota') from an unusable storage ('unavailable').
 */
import type { KeyValueStorage, StorageLike } from '../contracts/save';

export type StorageWriteFailure = 'quota' | 'unavailable';

export class StorageWriteError extends Error {
  readonly kind: StorageWriteFailure;

  constructor(kind: StorageWriteFailure, message: string) {
    super(message);
    this.name = 'StorageWriteError';
    this.kind = kind;
  }
}

const PROBE_KEY = 'linkline.__probe__';

function errorName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return '';
}

function errorCode(e: unknown): number {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'number') return e.code;
  return 0;
}

/** QuotaExceededError (all engines, including Firefox's legacy NS_ERROR_DOM_QUOTA_REACHED and code 22/1014). */
export function isQuotaError(e: unknown): boolean {
  if (e instanceof StorageWriteError) return e.kind === 'quota';
  const name = errorName(e);
  const code = errorCode(e);
  return (
    name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
  );
}

/** Plain Map-backed storage used when localStorage is unavailable. */
export function createMemoryKeyValue(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      map.set(k, v);
    },
    remove: (k) => {
      map.delete(k);
    },
  };
}

/** True when the storage can be read and written (a quota-full storage still counts as usable). */
function probe(storage: StorageLike): boolean {
  try {
    storage.getItem(PROBE_KEY);
  } catch {
    return false;
  }
  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return true;
  } catch (e) {
    return isQuotaError(e);
  }
}

function wrap(storage: StorageLike): KeyValueStorage {
  return {
    get(k: string): string | null {
      try {
        return storage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k: string, v: string): void {
      try {
        storage.setItem(k, v);
      } catch (e) {
        throw new StorageWriteError(isQuotaError(e) ? 'quota' : 'unavailable', `storage write failed: ${k}`);
      }
    },
    remove(k: string): void {
      try {
        storage.removeItem(k);
      } catch {
        // Removal is best effort (quarantine eviction); a failing storage is reported by the next write.
      }
    },
  };
}

/** try/catch wrapper over localStorage (or any StorageLike); falls back to memory when null/throwing. */
export function createKeyValueStorage(storage: StorageLike | null): {
  readonly kv: KeyValueStorage;
  readonly memoryOnly: boolean;
} {
  if (storage === null || !probe(storage)) return { kv: createMemoryKeyValue(), memoryOnly: true };
  return { kv: wrap(storage), memoryOnly: false };
}
