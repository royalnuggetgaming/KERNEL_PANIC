/**
 * Seeded patch-card offers (plan section 6 "PATCH CARDS"): 3 offers drawn without replacement, rarity by
 * sector weights, uniques already owned and cards at their stack cap excluded, fallback down the rarity
 * ladder and finally a free Shard Cache. A locked card keeps slot 0 at its original price.
 */
import type { CardId } from '../contracts/ids';
import type { CardDef, Rarity } from '../contracts/upgrades';
import type { Rng } from '../contracts/sim';
import { CARDS, OFFERS_PER_VISIT, RARITIES, RARITY_WEIGHTS } from '../config/cards';
import { cardPrice } from './pricing';

export interface LockedCard {
  readonly id: CardId;
  readonly price: number;
}

export interface CardOffer {
  readonly id: CardId;
  readonly price: number;
  readonly locked: boolean;
}

export interface OfferContext {
  readonly sector: 1 | 2 | 3;
  readonly wave: number;
  readonly owned: Uint8Array;
  readonly legendaryPool: boolean;
  readonly locked: LockedCard | null;
}

const SHARD_CACHE = CARDS.find((c) => c.id === 'shardCache')!;

/** Whether a card may be drawn as a fresh offer for this owner. */
export function isCardEligible(card: CardDef, owned: Uint8Array, legendaryPool: boolean): boolean {
  if (card.id === 'shardCache') return false;
  if (card.requiresMeta !== null && !legendaryPool) return false;
  const stacks = owned[card.bit] ?? 0;
  if (card.unique && stacks > 0) return false;
  return stacks < card.stackMax;
}

/** Rarity weights [C, U, R, L] for a sector; L is zero without the Legendary Pool. */
export function rarityWeights(sector: 1 | 2 | 3, legendaryPool: boolean): readonly number[] {
  const row = RARITY_WEIGHTS[sector - 1]!;
  return [row[0], row[1], row[2], legendaryPool ? row[3] : 0];
}

function drawOne(
  rng: Rng,
  ctx: OfferContext,
  weights: readonly number[],
  taken: ReadonlySet<CardId>,
  scratch: CardDef[],
): CardDef {
  const rolled = rng.weightedPick(weights);
  for (let r = rolled; r >= 0; r--) {
    const rarity: Rarity = RARITIES[r]!;
    scratch.length = 0;
    for (const c of CARDS) {
      if (c.rarity === rarity && !taken.has(c.id) && isCardEligible(c, ctx.owned, ctx.legendaryPool))
        scratch.push(c);
    }
    if (scratch.length > 0) return rng.pick(scratch);
  }
  return SHARD_CACHE;
}

/** 3 offers without replacement (a locked card keeps slot 0 at its original price), rarity fallback, Shard Cache. */
export function drawOffers(rng: Rng, ctx: OfferContext): readonly [CardOffer, CardOffer, CardOffer] {
  const weights = rarityWeights(ctx.sector, ctx.legendaryPool);
  const taken = new Set<CardId>();
  const offers: CardOffer[] = [];
  if (ctx.locked !== null) {
    offers.push({ id: ctx.locked.id, price: ctx.locked.price, locked: true });
    taken.add(ctx.locked.id);
  }
  const scratch: CardDef[] = [];
  while (offers.length < OFFERS_PER_VISIT) {
    const card = drawOne(rng, ctx, weights, taken, scratch);
    if (card.id !== 'shardCache') taken.add(card.id);
    offers.push({ id: card.id, price: cardPrice(card.id, ctx.wave), locked: false });
  }
  return [offers[0]!, offers[1]!, offers[2]!];
}
