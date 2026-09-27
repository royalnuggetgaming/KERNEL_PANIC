import { describe, expect, it } from 'vitest';
import type { SfxCategory } from '../../src/contracts/audio';
import {
  CATEGORY_LIMITS,
  COALESCE_S,
  SFX_CATEGORIES,
  VOICE_COUNT,
  VoicePool,
} from '../../src/audio/VoicePool';

describe('VoicePool', () => {
  it('limits sum to the 32 strips and ranges are disjoint', () => {
    let sum = 0;
    for (const c of SFX_CATEGORIES) sum += CATEGORY_LIMITS[c];
    expect(sum).toBe(VOICE_COUNT);
    expect(CATEGORY_LIMITS).toEqual({
      weapon: 8,
      impact: 6,
      explosion: 6,
      pickup: 4,
      player: 4,
      ui: 2,
      stinger: 2,
    });
    const pool = new VoicePool(VOICE_COUNT, CATEGORY_LIMITS);
    const seen = new Set<number>();
    for (const c of SFX_CATEGORIES) {
      for (let i = 0; i < CATEGORY_LIMITS[c]; i++) seen.add(pool.rangeStart(c) + i);
    }
    expect(seen.size).toBe(VOICE_COUNT);
  });

  it('rejects bad limits', () => {
    expect(() => new VoicePool(10, CATEGORY_LIMITS)).toThrow(RangeError);
    const bad: Record<SfxCategory, number> = { ...CATEGORY_LIMITS, ui: 0 };
    expect(() => new VoicePool(32, bad)).toThrow(RangeError);
  });

  it('respects the category limit and steals the oldest voice', () => {
    const pool = new VoicePool(VOICE_COUNT, CATEGORY_LIMITS);
    const used: number[] = [];
    // 8 weapon voices, each 1 s long, started 0.1 s apart (distinct ids avoid nothing: same id but > 25 ms apart).
    for (let i = 0; i < 8; i++) {
      const v = pool.acquire('laser', 'weapon', i * 0.1, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(pool.lastStolen).toBe(false);
      used.push(v);
    }
    expect(new Set(used).size).toBe(8);
    expect(pool.activeAt(0.75)).toBe(8);
    // 9th steals the oldest (started at 0).
    const ninth = pool.acquire('laser', 'weapon', 0.8, 1);
    expect(ninth).toBe(used[0]);
    expect(pool.lastStolen).toBe(true);
    expect(pool.stolen).toBe(1);
    // 10th steals the next oldest (started at 0.1).
    const tenth = pool.acquire('needle', 'weapon', 0.9, 1);
    expect(tenth).toBe(used[1]);
    expect(pool.stolen).toBe(2);
    // Never more than the limit active in the category.
    expect(pool.activeAt(0.95)).toBe(8);
  });

  it('a full category never takes another category’s strips', () => {
    const pool = new VoicePool(VOICE_COUNT, CATEGORY_LIMITS);
    for (let i = 0; i < 50; i++) pool.acquire('laser', 'weapon', i * 0.03, 5);
    const ui = pool.acquire('uiMove', 'ui', 2, 0.1);
    expect(ui).toBe(pool.rangeStart('ui'));
    expect(pool.lastStolen).toBe(false);
    expect(pool.activeAt(2)).toBe(9);
  });

  it('coalesces the same id within 25 ms', () => {
    const pool = new VoicePool(VOICE_COUNT, CATEGORY_LIMITS);
    expect(pool.acquire('hit', 'impact', 1, 0.1)).toBeGreaterThanOrEqual(0);
    expect(pool.acquire('hit', 'impact', 1 + COALESCE_S * 0.5, 0.1)).toBe(-1);
    expect(pool.acquire('hit', 'impact', 1 + COALESCE_S * 0.99, 0.1)).toBe(-1);
    expect(pool.coalesced).toBe(2);
    // A different id at the same time is not coalesced.
    expect(pool.acquire('crit', 'impact', 1.001, 0.1)).toBeGreaterThanOrEqual(0);
    // After the window the same id plays again.
    expect(pool.acquire('hit', 'impact', 1 + COALESCE_S + 0.001, 0.1)).toBeGreaterThanOrEqual(0);
    expect(pool.coalesced).toBe(2);
  });

  it('reclaims voices lazily by end time', () => {
    const pool = new VoicePool(VOICE_COUNT, CATEGORY_LIMITS);
    const a = pool.acquire('uiMove', 'ui', 0, 0.05);
    const b = pool.acquire('uiBack', 'ui', 0.01, 0.05);
    expect(a).not.toBe(b);
    expect(pool.active).toBe(2);
    // Both have ended by t=0.1: no steal.
    const c = pool.acquire('uiConfirm', 'ui', 0.1, 0.05);
    expect(pool.lastStolen).toBe(false);
    expect(c).toBe(a);
    expect(pool.idAt(c)).toBe('uiConfirm');
    expect(pool.stolen).toBe(0);
    expect(pool.activeAt(0.2)).toBe(0);
  });

  it('reset frees everything', () => {
    const pool = new VoicePool(VOICE_COUNT, CATEGORY_LIMITS);
    pool.acquire('explodeL', 'explosion', 0, 3);
    pool.reset();
    expect(pool.activeAt(0)).toBe(0);
    expect(pool.idAt(pool.rangeStart('explosion'))).toBeNull();
  });
});
