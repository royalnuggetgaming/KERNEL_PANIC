/**
 * Seeded patch-card offers (plan section 6 "PATCH CARDS"): 3 offers drawn without replacement, rarity by
 * sector weights, uniques already owned and cards at their stack cap excluded, fallback down the rarity
 * ladder and finally a free Shard Cache. A locked card keeps slot 0 at its original price.
 */
import type { CardId } from '../contracts/ids';
import type { CardDef, Rarity } from '../contracts/upgrades';
import type { Rng } from '../contracts/sim';
import { CARDS, MYTHIC, OFFERS_PER_VISIT, RARITIES, RARITY_WEIGHTS } from '../config/cards';
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
const MYTHIC_CARDS: readonly CardDef[] = CARDS.filter((c) => c.rarity === 'M');

/** Debug-only override of the Mythic chance per slot (null = MYTHIC.offerChance). Never set in normal play. */
let mythicChanceOverride: number | null = null;

/** Debug: force (1), forbid (0) or restore (null) Mythic offers. Values are clamped to [0, 1]. */
export function setMythicChanceOverride(chance: number | null): void {
  mythicChanceOverride = chance === null || !Number.isFinite(chance) ? null : Math.min(1, Math.max(0, chance));
}

/** Mythic chance per fresh offer slot for a sector (0 before MYTHIC.fromSector). */
export function mythicChance(sector: 1 | 2 | 3): number {
  if (mythicChanceOverride !== null) return mythicChanceOverride;
  return sector >= MYTHIC.fromSector ? MYTHIC.offerChance : 0;
}

/**
 * One Mythic roll for a fresh slot: exactly one draw from `rng` per call (so the stream stays aligned), and a
 * Mythic card only when one is still eligible (unique, not owned, not already offered).
 */
function rollMythic(rng: Rng, ctx: OfferContext, taken: ReadonlySet<CardId>): CardDef | null {
  const hit = rng.next() < mythicChance(ctx.sector);
  if (!hit) return null;
  for (const c of MYTHIC_CARDS) if (!taken.has(c.id) && isCardEligible(c, ctx.owned, true)) return c;
  return null;
}

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

/**
 * 3 offers without replacement (a locked card keeps slot 0 at its original price), rarity fallback, Shard Cache.
 * With `mythicRng`, each fresh slot first rolls for the Mythic card (MYTHIC.offerChance from sector 2).
 */
export function drawOffers(
  rng: Rng,
  ctx: OfferContext,
  mythicRng: Rng | null = null,
): readonly [CardOffer, CardOffer, CardOffer] {
  const weights = rarityWeights(ctx.sector, ctx.legendaryPool);
  const taken = new Set<CardId>();
  const offers: CardOffer[] = [];
  if (ctx.locked !== null) {
    offers.push({ id: ctx.locked.id, price: ctx.locked.price, locked: true });
    taken.add(ctx.locked.id);
  }
  const scratch: CardDef[] = [];
  while (offers.length < OFFERS_PER_VISIT) {
    const card = (mythicRng === null ? null : rollMythic(mythicRng, ctx, taken)) ?? drawOne(rng, ctx, weights, taken, scratch);
    if (card.id !== 'shardCache') taken.add(card.id);
    offers.push({ id: card.id, price: cardPrice(card.id, ctx.wave), locked: false });
  }
  return [offers[0]!, offers[1]!, offers[2]!];
}
