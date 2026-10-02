import { afterEach, describe, expect, it } from 'vitest';
import { CARD_IDS } from '../../src/contracts/ids';
import { MYTHIC } from '../../src/config/cards';
import { createRng } from '../../src/core/rng';
import {
  drawOffers,
  mythicChance,
  setMythicChanceOverride,
  type OfferContext,
} from '../../src/upgrades/offers';

function ctx(patch: Partial<OfferContext> = {}): OfferContext {
  return {
    sector: 2,
    wave: 6,
    owned: new Uint8Array(CARD_IDS.length),
    legendaryPool: false,
    locked: null,
    ...patch,
  };
}

afterEach(() => {
  setMythicChanceOverride(null);
});

describe('MYTHIC offers', () => {
  it('~0.5% per fresh slot from sector 2, never in sector 1, no Legendary Pool needed', () => {
    expect(mythicChance(1)).toBe(0);
    expect(mythicChance(2)).toBe(MYTHIC.offerChance);
    const rng = createRng(3);
    const mrng = createRng(4);
    let slots = 0;
    let hits = 0;
    for (let i = 0; i < 40_000; i++) {
      for (const o of drawOffers(rng, ctx(), mrng)) {
        slots++;
        if (o.id === 'rootOfAllEvil') hits++;
      }
    }
    expect(hits / slots).toBeGreaterThan(0.003);
    expect(hits / slots).toBeLessThan(0.007);
    const s1 = createRng(5);
    for (let i = 0; i < 5000; i++)
      for (const o of drawOffers(s1, ctx({ sector: 1 }), mrng)) expect(o.id).not.toBe('rootOfAllEvil');
  });

  it('is unique: never offered twice in one set, never once owned; costs the Mythic price', () => {
    setMythicChanceOverride(1);
    const offers = drawOffers(createRng(1), ctx(), createRng(2));
    expect(offers.filter((o) => o.id === 'rootOfAllEvil')).toHaveLength(1);
    expect(offers[0].price).toBeGreaterThan(250);
    const owned = new Uint8Array(CARD_IDS.length);
    owned[CARD_IDS.indexOf('rootOfAllEvil')] = 1;
    for (const o of drawOffers(createRng(1), ctx({ owned }), createRng(2)))
      expect(o.id).not.toBe('rootOfAllEvil');
  });

  it('a separate stream: without a hit the regular offers equal the no-Mythic draw', () => {
    setMythicChanceOverride(0);
    const a = drawOffers(createRng(9), ctx(), createRng(10));
    const b = drawOffers(createRng(9), ctx());
    expect(a).toEqual(b);
  });
});
