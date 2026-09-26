import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';

describe('rng (sfc32)', () => {
  it('produces a fixed golden sequence for a seed', () => {
    const r = createRng(12345);
    const seq = [r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32()];
    expect(seq).toEqual([1977310364, 4106765030, 1538400628, 2967644150, 3285158194]);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    const sc = Array.from({ length: 20 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('next() stays in [0, 1) and int() is inclusive and bounded', () => {
    const r = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const k = r.int(2, 5);
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(5);
      seen.add(k);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('forks are independent of the parent position and of each other', () => {
    const p1 = createRng(99);
    const p2 = createRng(99);
    for (let i = 0; i < 50; i++) p2.next();
    const f1 = p1.fork('shop', 3, 1);
    const f2 = p2.fork('shop', 3, 1);
    expect(f1.nextU32()).toBe(f2.nextU32());
    const other = createRng(99).fork('shop', 3, 0);
    const sim = createRng(99).fork('sim');
    const a = Array.from({ length: 8 }, () => createRng(99).fork('shop', 3, 1).nextU32());
    expect(new Set(a).size).toBe(1);
    expect(other.nextU32()).not.toBe(createRng(99).fork('shop', 3, 1).nextU32());
    expect(sim.nextU32()).not.toBe(createRng(99).fork('shop').nextU32());
  });

  it('forking does not advance the parent', () => {
    const a = createRng(5);
    const b = createRng(5);
    a.fork('x');
    expect(a.nextU32()).toBe(b.nextU32());
  });

  it('getState/setState round-trips the stream', () => {
    const r = createRng(2024);
    for (let i = 0; i < 10; i++) r.next();
    const st = new Uint32Array(4);
    r.getState(st);
    const expected = [r.nextU32(), r.nextU32()];
    r.setState(st);
    expect([r.nextU32(), r.nextU32()]).toEqual(expected);
    expect(() => {
      r.setState([1, 2]);
    }).toThrow(RangeError);
  });

  it('weightedPick respects weights and skips zero weights', () => {
    const r = createRng(3);
    const counts = [0, 0, 0];
    for (let i = 0; i < 10000; i++) counts[r.weightedPick([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.5);
    expect(counts[2]! / counts[0]!).toBeLessThan(3.5);
    expect(() => r.weightedPick([0, 0])).toThrow(RangeError);
  });

  it('pick, chance, range and shuffleInPlace behave', () => {
    const r = createRng(11);
    expect(() => r.pick([])).toThrow(RangeError);
    expect(['a', 'b']).toContain(r.pick(['a', 'b']));
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
    const x = r.range(-2, 2);
    expect(x).toBeGreaterThanOrEqual(-2);
    expect(x).toBeLessThan(2);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffleInPlace(arr);
    expect(out).toBe(arr);
    expect([...arr].sort((m, n) => m - n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
