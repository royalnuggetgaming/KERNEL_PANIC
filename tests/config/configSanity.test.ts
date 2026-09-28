import { describe, expect, it } from 'vitest';
import { CARD_IDS, ENEMY_KINDS, STAT_ROW_IDS, VEHICLE_IDS } from '../../src/contracts/ids';
import { NUMERIC_STATS } from '../../src/contracts/upgrades';
import { BOSS_DEFS } from '../../src/config/bosses';
import { CARDS, RARITY_WEIGHTS, cardDef } from '../../src/config/cards';
import { ENEMY_DEFS, eliteChance } from '../../src/config/enemies';
import { META_UPGRADES, metaMaxLevel } from '../../src/config/metaCatalog';
import { STAT_ROWS, TEAM_ITEMS, statRowDef, teamItemDef } from '../../src/config/runCatalog';
import { specialTierMul } from '../../src/config/specials';
import { VEHICLES, vehicleBaseStats } from '../../src/config/vehicles';
import { VERSUS, versusWaveForRound } from '../../src/config/versus';
import {
  bossForWave,
  clearBonus,
  isBossWave,
  pulseInterval,
  sectorOf,
  waveBudget,
  waveDuration,
  waveHpMul,
} from '../../src/config/waves';
import { DEFAULT_THEME_ID, getTheme, THEMES } from '../../src/themes/registry';
import { DIFFICULTY_IDS } from '../../src/contracts/save';
import { DIFFICULTY, difficultyDef } from '../../src/config/difficulty';

describe('config sanity', () => {
  it('wave formulas match the plan', () => {
    // v2 rebalance (user feedback "too many enemies"): round(18 + 8w + 0.9w^2), was round(30 + 14w + 1.8w^2)
    // (46 at w1, 645 at w15). HARD's budget multiplier (config/difficulty.ts) brings it back near v1.
    expect(waveBudget(1)).toBe(27);
    expect(waveBudget(15)).toBe(341);
    expect(waveDuration(1)).toBe(40);
    expect(waveDuration(15)).toBe(70);
    expect(sectorOf(5)).toBe(1);
    expect(sectorOf(6)).toBe(2);
    expect(sectorOf(15)).toBe(3);
    expect(sectorOf(40)).toBe(3);
    expect(pulseInterval(1)).toBe(3.8);
    expect(pulseInterval(11)).toBe(3.2);
    expect(isBossWave(10)).toBe(true);
    expect(isBossWave(9)).toBe(false);
    expect(bossForWave(5)).toBe('forkBomb');
    expect(bossForWave(10)).toBe('raceCondition');
    expect(bossForWave(15)).toBe('kernel');
    expect(bossForWave(20)).toBe('forkBomb');
    expect(bossForWave(25)).toBe('raceCondition');
    expect(bossForWave(7)).toBeNull();
    expect(waveHpMul(1)).toBe(1);
    // v2 rebalance: 5% HP growth per wave (was 7%) so later waves do not drag.
    expect(waveHpMul(16)).toBeCloseTo(Math.pow(1.05, 14) * 1.12);
    expect(clearBonus(3)).toBe(30);
    expect(eliteChance(1)).toBe(0);
    // v2 rebalance: 5% base elite chance (was 6%), +2% per sector unchanged.
    expect(eliteChance(2)).toBeCloseTo(0.05);
    expect(eliteChance(3)).toBeCloseTo(0.07);
  });

  it('versus rounds use non-boss wave rows', () => {
    expect([1, 2, 3, 4, 5].map(versusWaveForRound)).toEqual([1, 4, 7, 9, 13]);
    for (let r = 1; r <= VERSUS.MAX_ROUNDS; r++) expect(isBossWave(versusWaveForRound(r))).toBe(false);
  });

  it('catalogs are complete and consistent', () => {
    expect(STAT_ROWS.map((r) => r.id)).toEqual([...STAT_ROW_IDS]);
    expect(CARDS.map((c) => c.id)).toEqual([...CARD_IDS]);
    CARDS.forEach((c, i) => {
      expect(c.bit).toBe(i);
      expect(cardDef(c.id)).toBe(c);
      expect(c.requiresMeta).toBe(c.rarity === 'L' ? 'legendaryPool' : null);
    });
    expect(Object.keys(ENEMY_DEFS)).toEqual([...ENEMY_KINDS]);
    expect(Object.keys(VEHICLES)).toEqual([...VEHICLE_IDS]);
    for (const w of RARITY_WEIGHTS) expect(w.reduce((a, b) => a + b, 0)).toBe(100);
    expect(statRowDef('plating').maxLevel).toBe(8);
    expect(teamItemDef('linkRange').prices).toEqual([70, 130]);
    expect(TEAM_ITEMS).toHaveLength(4);
    expect(META_UPGRADES.reduce((s, m) => s + m.prices.reduce((a, b) => a + b, 0), 0)).toBeGreaterThan(1300);
    expect(metaMaxLevel('hullFw')).toBe(5);
    expect(() => statRowDef('nope' as never)).toThrow(RangeError);
    expect(BOSS_DEFS.raceCondition.parts).toBe(2);
    expect(specialTierMul(2)).toBe(1.5);
  });

  it('vehicle base stats fill every numeric stat', () => {
    for (const v of VEHICLE_IDS) {
      const s = vehicleBaseStats(v);
      for (const k of NUMERIC_STATS) expect(Number.isFinite(s[k]), `${v}.${k}`).toBe(true);
    }
    expect(vehicleBaseStats('bulwark').maxHp).toBe(150);
    expect(vehicleBaseStats('specter').dashCharges).toBe(2);
  });

  it('theme registry falls back to the default', () => {
    expect(getTheme('kernelPanic')).toBe(THEMES.kernelPanic);
    expect(getTheme('emberfall')).toBe(THEMES[DEFAULT_THEME_ID]);
    expect(getTheme(null).title).toBe('KERNEL PANIC');
    expect(getTheme('__proto__').id).toBe('kernelPanic');
  });
});

describe('difficulty table', () => {
  it('NORMAL is neutral, CASUAL is gentler and HARD harsher on every axis', () => {
    const axes = ['speed', 'budget', 'damage', 'hp'] as const;
    for (const a of axes) {
      expect(DIFFICULTY.normal[a]).toBe(1);
      expect(DIFFICULTY.casual[a]).toBeLessThan(1);
      expect(DIFFICULTY.hard[a]).toBeGreaterThan(1);
    }
    for (const id of DIFFICULTY_IDS) expect(DIFFICULTY[id].id).toBe(id);
    expect(difficultyDef(undefined)).toBe(DIFFICULTY.normal);
    expect(difficultyDef('hard')).toBe(DIFFICULTY.hard);
  });
});
