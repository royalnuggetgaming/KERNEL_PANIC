import { describe, expect, it } from 'vitest';
import { CARD_IDS, META_UPGRADE_IDS, STAT_ROW_IDS, type StatRowId } from '../../src/contracts/ids';
import { cardDef } from '../../src/config/cards';
import { metaDef } from '../../src/config/metaCatalog';
import {
  cardPrice,
  kernelPrice,
  metaPrice,
  repairPrice,
  rerollPrice,
  round5,
  statRowPrice,
  teamPrice,
  waveInflation,
} from '../../src/upgrades/pricing';

/** Golden table: price of level -> level + 1 for every stat row at waves 1, 5, 10, 15. */
const ROW_GOLDEN: Readonly<Record<number, Readonly<Record<StatRowId, readonly number[]>>>> = {
  1: {
    thrusters: [30, 40, 55, 75, 100, 135],
    plating: [25, 35, 40, 55, 70, 95, 120, 155],
    overclock: [35, 45, 65, 85, 115, 155, 210, 285],
    payload: [35, 45, 65, 85, 115, 155, 210, 285],
    magnet: [20, 25, 35, 45, 55],
    coolant: [30, 40, 55, 75, 100],
    capacitor: [30, 40, 55, 75, 100],
    specialTuning: [90, 160],
  },
  5: {
    thrusters: [35, 50, 70, 90, 125, 165],
    plating: [30, 40, 50, 70, 90, 115, 150, 195],
    overclock: [45, 60, 80, 105, 145, 195, 265, 355],
    payload: [45, 60, 80, 105, 145, 195, 265, 355],
    magnet: [25, 30, 40, 55, 70],
    coolant: [35, 50, 70, 90, 125],
    capacitor: [35, 50, 70, 90, 125],
    specialTuning: [110, 200],
  },
  10: {
    thrusters: [45, 60, 85, 115, 155, 205],
    plating: [40, 50, 65, 85, 110, 145, 185, 240],
    overclock: [55, 75, 100, 135, 180, 240, 325, 440],
    payload: [55, 75, 100, 135, 180, 240, 325, 440],
    magnet: [30, 40, 50, 70, 90],
    coolant: [45, 60, 85, 115, 155],
    capacitor: [45, 60, 85, 115, 155],
    specialTuning: [140, 250],
  },
  15: {
    thrusters: [55, 75, 100, 135, 185, 250],
    plating: [45, 60, 80, 100, 130, 170, 220, 290],
    overclock: [65, 85, 115, 160, 215, 290, 390, 525],
    payload: [65, 85, 115, 160, 215, 290, 390, 525],
    magnet: [35, 50, 60, 80, 105],
    coolant: [55, 75, 100, 135, 185],
    capacitor: [55, 75, 100, 135, 185],
    specialTuning: [165, 300],
  },
};

// M (the v3 Mythic tier, base 250) added; the other columns are unchanged.
const CARD_GOLDEN: Readonly<Record<number, Readonly<Record<'C' | 'U' | 'R' | 'L' | 'M', number>>>> = {
  1: { C: 45, U: 75, R: 120, L: 190, M: 250 },
  5: { C: 55, U: 95, R: 150, L: 235, M: 310 },
  10: { C: 70, U: 115, R: 185, L: 295, M: 385 },
  15: { C: 85, U: 140, R: 220, L: 350, M: 460 },
};

const REPAIR_GOLDEN: Readonly<Record<number, readonly number[]>> = {
  1: [20, 30],
  5: [35, 55],
  10: [55, 85],
  15: [75, 115],
};

const REROLL_GOLDEN: Readonly<Record<number, readonly number[]>> = {
  1: [5, 10, 15, 20, 25],
  5: [5, 10, 20, 25, 30],
  10: [10, 15, 25, 30, 40],
  15: [10, 20, 30, 35, 45],
};

const WAVES = [1, 5, 10, 15] as const;

describe('pricing', () => {
  it('round5 rounds to the nearest multiple of 5 and absorbs float noise', () => {
    expect(round5(0)).toBe(0);
    expect(round5(2.4)).toBe(0);
    expect(round5(2.5)).toBe(5);
    expect(round5(37.49999999999)).toBe(40);
    expect(round5(37.4)).toBe(35);
    expect(round5(123)).toBe(125);
    expect(() => round5(Number.NaN)).toThrow(RangeError);
    expect(() => round5(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('waveInflation is 1 + 0.06 (w - 1) and treats waves below 1 as wave 1', () => {
    expect(waveInflation(1)).toBe(1);
    expect(waveInflation(0)).toBe(1);
    expect(waveInflation(-4)).toBe(1);
    expect(waveInflation(11)).toBeCloseTo(1.6, 10);
    expect(() => waveInflation(Number.NaN)).toThrow(RangeError);
  });

  for (const w of WAVES) {
    it(`stat row golden table at wave ${w}`, () => {
      for (const id of STAT_ROW_IDS) {
        const got: number[] = [];
        for (let l = 0; l < ROW_GOLDEN[w]![id].length; l++) got.push(statRowPrice(id, l, w));
        expect(got, id).toEqual(ROW_GOLDEN[w]![id]);
      }
    });

    it(`card, repair and reroll golden values at wave ${w}`, () => {
      for (const id of CARD_IDS) {
        const expected = id === 'shardCache' ? 0 : CARD_GOLDEN[w]![cardDef(id).rarity];
        expect(cardPrice(id, w), id).toBe(expected);
      }
      expect([repairPrice(w, 0), repairPrice(w, 1)]).toEqual(REPAIR_GOLDEN[w]);
      expect([0, 1, 2, 3, 4].map((n) => rerollPrice(n, w))).toEqual(REROLL_GOLDEN[w]);
    });
  }

  it('stat rows throw past max level and for invalid levels', () => {
    expect(() => statRowPrice('thrusters', 6, 1)).toThrow(RangeError);
    expect(() => statRowPrice('thrusters', -1, 1)).toThrow(RangeError);
    expect(() => statRowPrice('thrusters', 1.5, 1)).toThrow(RangeError);
    expect(() => statRowPrice('thrusters', 0, Number.NaN)).toThrow(RangeError);
  });

  it('team prices are explicit, not wave-inflated; Spare Kernel escalates by 50% per purchase', () => {
    expect([0, 1, 2, 3].map((l) => teamPrice('linkAmp', l, 0))).toEqual([90, 150, 240, null]);
    expect([0, 1, 2].map((l) => teamPrice('linkRange', l, 0))).toEqual([70, 130, null]);
    expect([0, 1].map((l) => teamPrice('reviveProtocol', l, 0))).toEqual([110, null]);
    expect([0, 1, 2, 3].map((b) => kernelPrice(b))).toEqual([150, 225, 300, 375]);
    expect(teamPrice('spareKernel', 0, 2)).toBe(300);
    expect(() => kernelPrice(-1)).toThrow(RangeError);
  });

  it('meta prices follow the explicit Firmware list and return null when maxed', () => {
    for (const id of META_UPGRADE_IDS) {
      const prices = metaDef(id).prices;
      for (let l = 0; l < prices.length; l++) expect(metaPrice(id, l)).toBe(prices[l]);
      expect(metaPrice(id, prices.length)).toBeNull();
    }
    expect(metaPrice('hullFw', 0)).toBe(20);
    expect(metaPrice('secondBoot', 0)).toBe(150);
  });

  it('every price is a safe integer >= 5 (except the free Shard Cache) for waves 1..60', () => {
    for (let w = 1; w <= 60; w++) {
      for (const id of STAT_ROW_IDS) {
        for (let l = 0; l < 2; l++) {
          const p = statRowPrice(id, l, w);
          expect(Number.isSafeInteger(p) && p >= 5 && p % 5 === 0).toBe(true);
        }
      }
      for (const id of CARD_IDS) {
        const p = cardPrice(id, w);
        expect(Number.isSafeInteger(p)).toBe(true);
        expect(p === 0 ? id === 'shardCache' : p >= 5).toBe(true);
      }
      expect(Number.isSafeInteger(repairPrice(w, 1))).toBe(true);
      expect(Number.isSafeInteger(rerollPrice(7, w))).toBe(true);
    }
  });
});
