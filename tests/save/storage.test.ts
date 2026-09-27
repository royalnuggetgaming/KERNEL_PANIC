import { describe, expect, it } from 'vitest';
import { createKeyValueStorage, isQuotaError, StorageWriteError } from '../../src/save/storage';
import { MemoryStorage } from '../helpers/memoryStorage';

describe('createKeyValueStorage', () => {
  it('wraps a working storage', () => {
    const mem = new MemoryStorage();
    const { kv, memoryOnly } = createKeyValueStorage(mem);
    expect(memoryOnly).toBe(false);
    kv.set('a', '1');
    expect(mem.rawGet('a')).toBe('1');
    expect(kv.get('a')).toBe('1');
    kv.remove('a');
    expect(kv.get('a')).toBeNull();
    expect(mem.rawGet('linkline.__probe__')).toBeNull();
  });

  it('falls back to memory when storage is null or throws SecurityError', () => {
    const none = createKeyValueStorage(null);
    expect(none.memoryOnly).toBe(true);
    none.kv.set('k', 'v');
    expect(none.kv.get('k')).toBe('v');
    none.kv.remove('k');
    expect(none.kv.get('k')).toBeNull();
    const mem = new MemoryStorage();
    mem.failMode = 'security';
    const r = createKeyValueStorage(mem);
    expect(r.memoryOnly).toBe(true);
    r.kv.set('k', 'v');
    expect(r.kv.get('k')).toBe('v');
  });

  it('keeps a quota-full storage (reads still work) and reports quota write failures', () => {
    const mem = new MemoryStorage();
    mem.rawSet('x', 'y');
    mem.failMode = 'quota';
    const { kv, memoryOnly } = createKeyValueStorage(mem);
    expect(memoryOnly).toBe(false);
    expect(kv.get('x')).toBe('y');
    let caught: unknown = null;
    try {
      kv.set('a', 'b');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StorageWriteError);
    expect((caught as StorageWriteError).kind).toBe('quota');
    expect(isQuotaError(caught)).toBe(true);
  });

  it('turns a storage that starts failing into unavailable writes and null reads', () => {
    const mem = new MemoryStorage();
    const { kv } = createKeyValueStorage(mem);
    mem.failMode = 'security';
    expect(kv.get('a')).toBeNull();
    expect(() => {
      kv.remove('a');
    }).not.toThrow();
    let kind = '';
    try {
      kv.set('a', 'b');
    } catch (e) {
      kind = (e as StorageWriteError).kind;
    }
    expect(kind).toBe('unavailable');
  });

  it('isQuotaError recognises every engine flavour', () => {
    expect(isQuotaError(new DOMException('q', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError({ code: 1014 })).toBe(true);
    expect(isQuotaError(new Error('x'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(new StorageWriteError('unavailable', 'x'))).toBe(false);
  });
});
