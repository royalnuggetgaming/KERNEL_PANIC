import { describe, expect, it } from 'vitest';
import type { PooledRecord } from '../../src/contracts/sim';
import { EntityPool, pooledBase } from '../../src/core/EntityPool';

interface Rec extends PooledRecord {
  v: number;
}

const make = (cap: number): EntityPool<Rec> =>
  new EntityPool<Rec>(cap, (slot) => ({ ...pooledBase(slot), v: 0 }));

describe('EntityPool', () => {
  it('spawns up to capacity then returns null and counts exhaustion', () => {
    const p = make(3);
    expect(p.spawn()).not.toBeNull();
    expect(p.spawn()).not.toBeNull();
    expect(p.spawn()).not.toBeNull();
    expect(p.count).toBe(3);
    expect(p.spawn()).toBeNull();
    expect(p.exhausted).toBe(1);
  });

  it('keeps a dense active array with swap-remove', () => {
    const p = make(4);
    const a = p.spawn()!;
    const b = p.spawn()!;
    const c = p.spawn()!;
    a.v = 1;
    b.v = 2;
    c.v = 3;
    p.despawn(a);
    expect(p.count).toBe(2);
    const live = p.active.slice(0, p.count).map((r) => r.v);
    expect(live.sort()).toEqual([2, 3]);
    for (let i = 0; i < p.count; i++) expect(p.active[i]!.di).toBe(i);
    expect(p.isAlive(a)).toBe(false);
    expect(a.di).toBe(-1);
    p.despawn(a);
    expect(p.count).toBe(2);
  });

  it('generational handles go stale after despawn and slot reuse', () => {
    const p = make(2);
    const a = p.spawn()!;
    const h = p.handleOf(a);
    expect(p.resolve(h)).toBe(a);
    p.despawn(a);
    expect(p.resolve(h)).toBeNull();
    const again = p.spawn()!;
    expect(again.slot).toBe(a.slot);
    expect(p.resolve(h)).toBeNull();
    expect(p.resolve(p.handleOf(again))).toBe(again);
    expect(p.resolve(-1)).toBeNull();
    expect(p.resolve(999 * 256)).toBeNull();
  });

  it('spawnRecycling reuses the oldest record when full', () => {
    const p = make(3);
    const a = p.spawn()!;
    p.spawn();
    p.spawn();
    const hA = p.handleOf(a);
    const r = p.spawnRecycling();
    expect(r.slot).toBe(a.slot);
    expect(p.resolve(hA)).toBeNull();
    expect(p.count).toBe(3);
  });

  it('atSlot, clear and constructor validation', () => {
    const p = make(2);
    const a = p.spawn()!;
    expect(p.atSlot(a.slot)).toBe(a);
    expect(() => p.atSlot(5)).toThrow(RangeError);
    p.spawn();
    p.spawn();
    p.clear();
    expect(p.count).toBe(0);
    expect(p.exhausted).toBe(0);
    expect(p.spawn()).not.toBeNull();
    expect(() => make(0)).toThrow(RangeError);
  });

  it('iterating backwards while despawning visits every live record once', () => {
    const p = make(16);
    for (let i = 0; i < 16; i++) p.spawn()!.v = i;
    const visited: number[] = [];
    for (let i = p.count - 1; i >= 0; i--) {
      const r = p.active[i]!;
      visited.push(r.v);
      if (r.v % 2 === 0) p.despawn(r);
    }
    expect(visited.sort((x, y) => x - y)).toEqual([...Array(16).keys()]);
    expect(p.count).toBe(8);
  });
});
