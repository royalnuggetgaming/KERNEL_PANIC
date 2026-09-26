/**
 * Web Storage double (StorageLike) with injectable failures, plus a KeyValueStorage view for SaveStore tests.
 */
import type { KeyValueStorage, StorageLike } from '../../src/contracts/save';

export type StorageFailMode = 'none' | 'quota' | 'security';

function quotaError(): Error {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

function securityError(): Error {
  return new DOMException('The operation is insecure.', 'SecurityError');
}

export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  /** 'security' throws on every access (private mode); 'quota' throws on writes. */
  failMode: StorageFailMode = 'none';
  /** Fail only the next N writes with QuotaExceeded (then recover). */
  failNextWrites = 0;
  /** Total characters allowed across keys+values (Infinity = unlimited). */
  quotaChars = Number.POSITIVE_INFINITY;
  readonly writes: { key: string; value: string }[] = [];

  getItem(key: string): string | null {
    if (this.failMode === 'security') throw securityError();
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failMode === 'security') throw securityError();
    if (this.failMode === 'quota') throw quotaError();
    if (this.failNextWrites > 0) {
      this.failNextWrites--;
      throw quotaError();
    }
    const prev = this.map.get(key);
    const size =
      this.usedChars() - (prev === undefined ? 0 : key.length + prev.length) + key.length + value.length;
    if (size > this.quotaChars) throw quotaError();
    this.map.set(key, value);
    this.writes.push({ key, value });
  }

  removeItem(key: string): void {
    if (this.failMode === 'security') throw securityError();
    this.map.delete(key);
  }

  /** Test-side direct access that never fails (simulate another tab or corrupt data). */
  rawSet(key: string, value: string): void {
    this.map.set(key, value);
  }

  rawGet(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  usedChars(): number {
    let n = 0;
    for (const [k, v] of this.map) n += k.length + v.length;
    return n;
  }
}

/** KeyValueStorage over a StorageLike WITHOUT try/catch (so tests see the raw exceptions). */
export function keyValueOf(s: StorageLike): KeyValueStorage {
  return {
    get: (k) => s.getItem(k),
    set: (k, v) => {
      s.setItem(k, v);
    },
    remove: (k) => {
      s.removeItem(k);
    },
  };
}
