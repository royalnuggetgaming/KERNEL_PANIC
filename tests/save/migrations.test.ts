import { describe, expect, it } from 'vitest';
import type { Migration } from '../../src/contracts/save';
import { CURRENT_SAVE_VERSION } from '../../src/contracts/save';
import { MIGRATIONS, RETIRED_FIRMWARE_V2, migrate, migrateV1toV2 } from '../../src/save/migrations';

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
    expect(migrate(input, CURRENT_SAVE_VERSION)).toBe(input); // production registry: already current
  });

  it('throws on a missing step, a newer version or a bad version', () => {
    expect(() => migrate({}, 0, REGISTRY, 3)).toThrow(/v0/);
    expect(() => migrate({}, 4, REGISTRY, 3)).toThrow(RangeError);
    expect(() => migrate({}, -1)).toThrow(RangeError);
    expect(() => migrate({}, 1.5)).toThrow(RangeError);
  });

  it('the production registry has exactly the v1 -> v2 step and is frozen', () => {
    expect(CURRENT_SAVE_VERSION).toBe(2);
    expect(Object.keys(MIGRATIONS)).toEqual(['1']);
    expect(Object.isFrozen(MIGRATIONS)).toBe(true);
  });
});

describe('v1 -> v2 (Firmware merge)', () => {
  it('refunds every Core recorded for the retired lines and drops their levels', () => {
    const v1 = {
      cores: 40,
      meta: { hullFw: 2, magnetFw: 3, rerollCache: 2, fieldMedic: 1, legendaryPool: 1 },
      firmwareSpent: { hullFw: 55, magnetFw: 95, rerollCache: 180, fieldMedic: 30, legendaryPool: 120 },
      settings: { master: 0.5 },
    };
    const out = migrateV1toV2(v1) as Record<string, unknown>;
    expect(out.cores).toBe(40 + 95 + 180 + 30);
    expect(out.meta).toEqual({ hullFw: 2, legendaryPool: 1 });
    expect(out.firmwareSpent).toEqual({ hullFw: 55, legendaryPool: 120 });
    expect(out.cheats).toEqual({ unlocked: [], enabled: [] });
    expect(out.settings).toEqual({ master: 0.5 });
    // Pure: the input is untouched.
    expect(v1.meta.magnetFw).toBe(3);
    expect(RETIRED_FIRMWARE_V2).toEqual(['rerollCache', 'magnetFw', 'fieldMedic']);
  });

  it('never loses value on odd input and passes garbage through for sanitizeSave', () => {
    expect(migrateV1toV2(null)).toBeNull();
    expect(migrateV1toV2([1])).toEqual([1]);
    const odd = migrateV1toV2({ cores: 'x', firmwareSpent: { magnetFw: -5, fieldMedic: 12.7 } }) as {
      cores: number;
    };
    expect(odd.cores).toBe(12);
  });
});
