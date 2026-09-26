import { describe, expect, it } from 'vitest';
import { crc32, fnv1a, fnv1aMixF64, fnv1aMixU32, FNV_OFFSET, stableStringify } from '../../src/core/hash';

describe('hash', () => {
  it('crc32 golden values (UTF-8)', () => {
    expect(crc32('')).toBe(0);
    expect(crc32('The quick brown fox jumps over the lazy dog')).toBe(0x414fa339);
    expect(crc32('héllo €')).toBe(0xe131580e);
  });

  it('fnv1a golden values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('streaming mixers are deterministic and bit-exact', () => {
    const a = fnv1aMixF64(fnv1aMixU32(FNV_OFFSET, 42), 1.5);
    const b = fnv1aMixF64(fnv1aMixU32(FNV_OFFSET, 42), 1.5);
    expect(a).toBe(b);
    expect(fnv1aMixF64(FNV_OFFSET, 0)).not.toBe(fnv1aMixF64(FNV_OFFSET, -0));
    expect(fnv1aMixF64(FNV_OFFSET, 1.5)).not.toBe(fnv1aMixF64(FNV_OFFSET, 1.5000000001));
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it('stableStringify ignores key order and matches JSON semantics', () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      stableStringify({ a: { c: 'x', d: [3, { y: 2, z: 1 }] }, b: 1 }),
    );
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify({ a: undefined, b: Number.NaN, c: [undefined, Infinity] })).toBe(
      '{"b":null,"c":[null,null]}',
    );
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('s')).toBe('"s"');
    expect(stableStringify(undefined)).toBe('null');
    expect(() => stableStringify({ n: 1n })).toThrow(TypeError);
  });
});
