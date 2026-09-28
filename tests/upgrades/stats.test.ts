import { describe, expect, it } from 'vitest';
import {
  CARD_IDS,
  STAT_ROW_IDS,
  VEHICLE_IDS,
  type CardId,
  type MetaLevels,
  type StatRowId,
} from '../../src/contracts/ids';
import { cardDef } from '../../src/config/cards';
import { STAT_CAPS } from '../../src/config/tuning';
import { vehicleBaseStats } from '../../src/config/vehicles';
import { createRng } from '../../src/core/rng';
import {
  capsReached,
  computeStats,
  emptyRowLevels,
  emptyTeamLevels,
  statsEqual,
} from '../../src/upgrades/stats';

function cards(stacks: Partial<Record<CardId, number>>): Uint8Array {
  const out = new Uint8Array(CARD_IDS.length);
  for (const [id, n] of Object.entries(stacks)) out[cardDef(id as CardId).bit] = n;
  return out;
}

const NO_META: MetaLevels = {};

describe('computeStats', () => {
  it('equals the vehicle base with no modifiers', () => {
    for (const v of VEHICLE_IDS) {
      expect(computeStats(v, NO_META, emptyRowLevels(), cards({}), emptyTeamLevels())).toEqual(
        vehicleBaseStats(v),
      );
    }
  });

  it('applies (base + flat) x (1 + add) x mul across meta, rows, cards and team', () => {
    const rows = { ...emptyRowLevels(), plating: 2, payload: 2 };
    const s = computeStats(
      'lancer',
      { hullFw: 2 },
      rows,
      cards({ glassLens: 1, splitShot: 1 }),
      emptyTeamLevels(),
    );
    // maxHp: (100 + 40) x (1 + 0.10) x 0.8 = 123.2 -> 123
    expect(s.maxHp).toBe(123);
    // damage: 1 x (1 + 0.30 + 0.35) x 0.85
    expect(s.damageMul).toBeCloseTo(1.65 * 0.85, 10);
    const team = computeStats('lancer', NO_META, emptyRowLevels(), cards({}), {
      ...emptyTeamLevels(),
      linkAmp: 2,
      linkRange: 2,
      reviveProtocol: 1,
    });
    expect(team.linkDps).toBeCloseTo(22 * 1.8, 10);
    expect(team.linkRange).toBe(22);
    expect(team.reviveTime).toBeCloseTo(1.2, 10);
    expect(team.reviveHpFrac).toBeCloseTo(0.6, 10);
  });

  it('is independent of purchase order (shuffled sequences give identical stats)', () => {
    const rng = createRng(1234);
    for (let trial = 0; trial < 50; trial++) {
      const buys: ({ row: StatRowId } | { card: CardId })[] = [];
      for (let i = 0; i < 20; i++) {
        if (rng.chance(0.5)) buys.push({ row: rng.pick(STAT_ROW_IDS) });
        else buys.push({ card: rng.pick(CARD_IDS.filter((c) => c !== 'shardCache')) });
      }
      const results = [0, 1, 2].map(() => {
        const order = rng.shuffleInPlace(buys.slice());
        // Build the records in purchase order so key insertion order differs too.
        const rows: Record<string, number> = {};
        const owned = new Uint8Array(CARD_IDS.length);
        for (const b of order) {
          if ('row' in b) rows[b.row] = (rows[b.row] ?? 0) + 1;
          else owned[cardDef(b.card).bit]!++;
        }
        const fullRows = { ...emptyRowLevels() };
        for (const id of STAT_ROW_IDS) fullRows[id] = rows[id] ?? 0;
        return computeStats('specter', { overclockFw: 3, hullFw: 1 }, fullRows, owned, emptyTeamLevels());
      });
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    }
  });

  it('enforces every hard cap', () => {
    const rows = {
      thrusters: 50,
      plating: 50,
      overclock: 50,
      payload: 50,
      magnet: 50,
      coolant: 50,
      capacitor: 5,
      specialTuning: 9,
    };
    const owned = cards({ pierce: 20, ricochet: 20, doubleBuffer: 9 });
    for (const v of VEHICLE_IDS) {
      const s = computeStats(v, { bootCache: 3 }, rows, owned, emptyTeamLevels());
      const base = vehicleBaseStats(v);
      expect(s.moveSpeed).toBeCloseTo(base.moveSpeed * STAT_CAPS.moveSpeedMulMax, 10);
      expect(s.fireRate).toBe(STAT_CAPS.fireRateMax);
      expect(s.damageMul).toBe(STAT_CAPS.damageMulMax);
      expect(s.pierce).toBe(STAT_CAPS.pierceMax);
      expect(s.bounces).toBe(STAT_CAPS.bouncesMax);
      expect(s.dashCooldown).toBe(STAT_CAPS.dashCooldownMin);
      expect(s.dashCharges).toBe(STAT_CAPS.dashChargesMax);
      expect(s.maxHp).toBe(STAT_CAPS.maxHpMax);
      expect(s.magnetRadius).toBe(STAT_CAPS.magnetRadiusMax);
      expect(s.specialTier).toBe(STAT_CAPS.specialTierMax);
      const caps = capsReached(s, v);
      for (const k of [
        'moveSpeed',
        'fireRate',
        'damageMul',
        'pierce',
        'bounces',
        'dashCooldown',
        'dashCharges',
        'maxHp',
        'magnetRadius',
        'specialTier',
      ] as const)
        expect(caps.has(k), k).toBe(true);
    }
  });

  it('caps projectiles, crit, armor and keeps max HP >= 1 via overrides', () => {
    const s = computeStats('bulwark', NO_META, emptyRowLevels(), cards({ glassLens: 1 }), emptyTeamLevels(), {
      projectilesMax: 2,
      armorMax: 0.1,
      maxHpMin: 200,
    });
    expect(s.projectiles).toBe(2);
    expect(s.armor).toBe(0.1);
    expect(s.maxHp).toBe(200);
    const caps = capsReached(s, 'bulwark', { projectilesMax: 2, armorMax: 0.1 });
    expect(caps.has('projectiles')).toBe(true);
    expect(caps.has('armor')).toBe(true);
    expect(caps.has('critChance')).toBe(false);
    const crit = capsReached({ ...s, critChance: 0.5 }, 'bulwark');
    expect(crit.has('critChance')).toBe(true);
  });

  it('converts fire-rate overflow above 20/s into a damage multiplier', () => {
    const rows = { ...emptyRowLevels(), overclock: 8 };
    const s = computeStats('specter', { overclockFw: 5 }, rows, cards({}), emptyTeamLevels());
    const raw = 14 * (1 + 0.96 + 0.15);
    expect(s.fireRate).toBe(20);
    expect(s.damageMul).toBeCloseTo(raw / 20, 10);
    // Below the cap nothing is converted.
    const lancer = computeStats('lancer', NO_META, rows, cards({}), emptyTeamLevels());
    expect(lancer.fireRate).toBeCloseTo(9 * 1.96, 10);
    expect(lancer.damageMul).toBe(1);
  });

  it('Glass Lens lowers max HP by 20% but never below 1', () => {
    const s = computeStats('lancer', NO_META, emptyRowLevels(), cards({ glassLens: 1 }), emptyTeamLevels());
    expect(s.maxHp).toBe(80);
    const tiny = computeStats(
      'lancer',
      NO_META,
      emptyRowLevels(),
      cards({ glassLens: 60 }),
      emptyTeamLevels(),
    );
    expect(tiny.maxHp).toBe(1);
  });

  it('ignores negative, NaN and missing levels', () => {
    const rows = { ...emptyRowLevels(), thrusters: -3, plating: Number.NaN };
    const s = computeStats('lancer', { hullFw: -2 }, rows, cards({}), emptyTeamLevels());
    expect(s).toEqual(vehicleBaseStats('lancer'));
  });

  it('statsEqual compares every stat', () => {
    const a = vehicleBaseStats('lancer');
    expect(statsEqual(a, { ...a })).toBe(true);
    expect(statsEqual(a, { ...a, armor: 0.01 })).toBe(false);
  });
});
