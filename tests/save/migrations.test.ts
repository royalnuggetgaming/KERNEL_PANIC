import { describe, expect, it } from 'vitest';
import type { Migration } from '../../src/contracts/save';
import { MIGRATIONS, migrate } from '../../src/save/migrations';

interface V1 {
  cores: number;
}
interface V2 {
  cores: number;
  gems: number;
}
interface V3 {
  wallet: { cores: number; gems: number };
}

const REGISTRY: Readonly<Record<number, Migration>> = {
  1: (d) => ({ ...(d as V1), gems: 0 }),
  2: (d) => {
    const v2 = d as V2;
    return { wallet: { cores: v2.cores, gems: v2.gems } };
  },
};

describe('migrate', () => {
  it('applies an injected v1 -> v2 -> v3 chain in order', () => {
    expect(migrate({ cores: 5 }, 1, REGISTRY, 3)).toEqual({ wallet: { cores: 5, gems: 0 } });
    expect(migrate({ cores: 5, gems: 2 }, 2, REGISTRY, 3)).toEqual({ wallet: { cores: 5, gems: 2 } });
  });

  it('is idempotent at the target version and never mutates its input', () => {
    const input = { cores: 9 };
    const once = migrate(input, 1, REGISTRY, 3) as V3;
    expect(migrate(once, 3, REGISTRY, 3)).toBe(once);
    expect(input).toEqual({ cores: 9 });
    expect(migrate(input, 1)).toBe(input); // production registry: v1 is current
  });

  it('throws on a missing step, a newer version or a bad version', () => {
    expect(() => migrate({}, 0, REGISTRY, 3)).toThrow(/v0/);
    expect(() => migrate({}, 4, REGISTRY, 3)).toThrow(RangeError);
    expect(() => migrate({}, -1)).toThrow(RangeError);
    expect(() => migrate({}, 1.5)).toThrow(RangeError);
  });

  it('the production registry is empty and frozen for v1', () => {
    expect(Object.keys(MIGRATIONS)).toEqual([]);
    expect(Object.isFrozen(MIGRATIONS)).toBe(true);
  });
});
