import { describe, expect, it } from 'vitest';
import { CARD_IDS, type CardId } from '../../src/contracts/ids';
import { CARDS, cardDef, RARITY_WEIGHTS } from '../../src/config/cards';
import { createRng } from '../../src/core/rng';
import { drawOffers, isCardEligible, rarityWeights, type OfferContext } from '../../src/upgrades/offers';

function owned(stacks: Partial<Record<CardId, number>> = {}): Uint8Array {
  const out = new Uint8Array(CARD_IDS.length);
  for (const [id, n] of Object.entries(stacks)) out[cardDef(id as CardId).bit] = n;
  return out;
}

function ctx(patch: Partial<OfferContext> = {}): OfferContext {
  return { sector: 1, wave: 1, owned: owned(), legendaryPool: false, locked: null, ...patch };
}

describe('drawOffers', () => {
  it('draws 3 distinct cards (without replacement) priced for the wave', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const offers = drawOffers(rng, ctx({ wave: 10, sector: 2 }));
      const ids = offers.map((o) => o.id).filter((id) => id !== 'shardCache');
      expect(new Set(ids).size).toBe(ids.length);
      for (const o of offers) {
        expect(o.locked).toBe(false);
        expect(Number.isSafeInteger(o.price)).toBe(true);
      }
    }
  });

  it('is deterministic for the same forked stream', () => {
    const a = drawOffers(createRng(99).fork('shop', 3, 1), ctx());
    const b = drawOffers(createRng(99).fork('shop', 3, 1), ctx());
    const c = drawOffers(createRng(99).fork('shop', 3, 0), ctx());
    expect(a).toEqual(b);
    expect([a, b, c].length).toBe(3);
  });

  it('excludes owned uniques, cards at their stack cap and Legendaries without the pool', () => {
    const own = owned({ afterimage: 1, doubleBuffer: 1, overheat: 1, splitShot: 2, bounty: 2, pierce: 3 });
    const rng = createRng(11);
    for (let i = 0; i < 1000; i++) {
      for (const o of drawOffers(rng, ctx({ owned: own, sector: 3 }))) {
        expect(['afterimage', 'doubleBuffer', 'overheat', 'splitShot', 'bounty', 'pierce']).not.toContain(o.id);
        expect(cardDef(o.id).rarity === 'L').toBe(false);
      }
    }
  });

  it('offers Legendaries only with the Legendary Pool firmware', () => {
    const rng = createRng(5);
    let legendaries = 0;
    for (let i = 0; i < 2000; i++)
      for (const o of drawOffers(rng, ctx({ legendaryPool: true, sector: 3 })))
        if (cardDef(o.id).rarity === 'L') legendaries++;
    expect(legendaries).toBeGreaterThan(0);
    expect(rarityWeights(1, false)).toEqual([60, 28, 10, 0]);
    expect(rarityWeights(3, true)).toEqual([40, 32, 20, 8]);
  });

  it('matches the rarity weights per sector', () => {
    for (const sector of [1, 2, 3] as const) {
      const rng = createRng(1000 + sector);
      const counts = { C: 0, U: 0, R: 0, L: 0 };
      const n = 20000;
      // Only the first slot of a fresh set is an unbiased single draw (later slots shrink the pools).
      for (let i = 0; i < n; i++) {
        const o = drawOffers(rng, ctx({ sector, legendaryPool: true }))[0];
        counts[cardDef(o.id).rarity]++;
      }
      const w = RARITY_WEIGHTS[sector - 1]!;
      const total = w[0] + w[1] + w[2] + w[3];
      expect(counts.C / n).toBeCloseTo(w[0] / total, 1);
      expect(counts.U / n).toBeCloseTo(w[1] / total, 1);
      expect(counts.R / n).toBeCloseTo(w[2] / total, 1);
      expect(counts.L / n).toBeCloseTo(w[3] / total, 1);
    }
  });

  it('falls back down the rarity ladder and finally to the free Shard Cache', () => {
    // Every Common and Uncommon is exhausted: Rares are drawn, rolls of C/U fall to the Shard Cache.
    const allCU: Partial<Record<CardId, number>> = {};
    for (const c of CARDS) if (c.rarity === 'C' || c.rarity === 'U') allCU[c.id] = c.stackMax;
    const rng = createRng(3);
    let caches = 0;
    let rares = 0;
    for (let i = 0; i < 500; i++) {
      for (const o of drawOffers(rng, ctx({ owned: owned(allCU) }))) {
        if (o.id === 'shardCache') {
          caches++;
          expect(o.price).toBe(0);
        } else {
          expect(cardDef(o.id).rarity).toBe('R');
          rares++;
        }
      }
    }
    expect(caches).toBeGreaterThan(0);
    expect(rares).toBeGreaterThan(0);

    // Everything exhausted: three Shard Caches.
    const all: Partial<Record<CardId, number>> = {};
    for (const c of CARDS) all[c.id] = c.stackMax;
    const offers = drawOffers(createRng(1), ctx({ owned: owned(all), legendaryPool: true }));
    expect(offers.map((o) => o.id)).toEqual(['shardCache', 'shardCache', 'shardCache']);
  });

  it('a Legendary roll falls back to a Rare when all Legendaries are owned', () => {
    const own = owned({ forkCall: 1, sudo: 1, rootAccess: 1 });
    const rng = createRng(21);
    for (let i = 0; i < 500; i++)
      for (const o of drawOffers(rng, ctx({ owned: own, legendaryPool: true, sector: 3 })))
        expect(cardDef(o.id).rarity).not.toBe('L');
  });

  it('carries a locked card over in slot 0 at its original price and never duplicates it', () => {
    const rng = createRng(8);
    for (let i = 0; i < 300; i++) {
      const offers = drawOffers(rng, ctx({ wave: 12, sector: 3, locked: { id: 'chainArc', price: 120 } }));
      expect(offers[0]).toEqual({ id: 'chainArc', price: 120, locked: true });
      expect(offers[1].id).not.toBe('chainArc');
      expect(offers[2].id).not.toBe('chainArc');
    }
  });

  it('isCardEligible never offers the Shard Cache as a regular card', () => {
    expect(isCardEligible(cardDef('shardCache'), owned(), true)).toBe(false);
    expect(isCardEligible(cardDef('sudo'), owned(), false)).toBe(false);
    expect(isCardEligible(cardDef('sudo'), owned(), true)).toBe(true);
    expect(isCardEligible(cardDef('overdriveBattery'), owned({ overdriveBattery: 2 }), false)).toBe(true);
    expect(isCardEligible(cardDef('overdriveBattery'), owned({ overdriveBattery: 3 }), false)).toBe(false);
  });
});
