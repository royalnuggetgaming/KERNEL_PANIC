/**
 * Read-only validation of every shop purchase. Shared by the transaction handlers (apply re-validates
 * everything) and the snapshot (row statuses), so the UI and the rules can never disagree.
 */
import type { PlayerIndex, StatRowId, TeamItemId } from '../contracts/ids';
import type { CardDef, PurchaseFailure } from '../contracts/upgrades';
import { cardDef } from '../config/cards';
import { metaLevel } from '../config/metaCatalog';
import { REPAIR, UTILITY_PRICES, statRowDef, teamItemDef } from '../config/runCatalog';
import { ECONOMY } from '../config/tuning';
import { repairPrice, rerollPrice, statRowPrice, teamPrice } from './pricing';
import { computeStats, statsEqual } from './stats';
import { partnerOf, statsOf, type OfferSlot, type ShopState } from './shopState';

export interface Check {
  /** null when there is no price to show (maxed, sold out, bought). */
  readonly price: number | null;
  readonly fail: PurchaseFailure | null;
}

function check(price: number | null, fail: PurchaseFailure | null): Check {
  return { price, fail };
}

function funds(s: ShopState, p: PlayerIndex, price: number): Check {
  return check(price, s.players[p].wallet < price ? 'funds' : null);
}

/** True when buying one more level of the row changes no derived stat (rule 'capped'). */
export function rowIsCapped(s: ShopState, p: PlayerIndex, id: StatRowId): boolean {
  const player = s.players[p];
  const before = statsOf(s, p, player);
  const rows = { ...player.rows, [id]: player.rows[id] + 1 };
  const after = computeStats(s.vehicles[p], s.meta, rows, player.cards, s.team.levels, s.caps, s.extraMods);
  return statsEqual(before, after);
}

/** True when one more stack of a pure-stat card changes no derived stat. Effect cards are never capped. */
export function cardIsCapped(s: ShopState, p: PlayerIndex, def: CardDef): boolean {
  if (def.effectFlag !== 0 || def.modifiers.length === 0) return false;
  const player = s.players[p];
  const before = statsOf(s, p, player);
  const cards = player.cards.slice();
  cards[def.bit] = (cards[def.bit] ?? 0) + 1;
  const after = computeStats(s.vehicles[p], s.meta, player.rows, cards, s.team.levels, s.caps, s.extraMods);
  return statsEqual(before, after);
}

export function checkRow(s: ShopState, p: PlayerIndex, id: StatRowId): Check {
  const level = s.players[p].rows[id];
  if (level >= statRowDef(id).maxLevel) return check(null, 'maxLevel');
  const price = statRowPrice(id, level, s.wave);
  if (rowIsCapped(s, p, id)) return check(price, 'capped');
  return funds(s, p, price);
}

export function checkCard(s: ShopState, p: PlayerIndex, offer: OfferSlot | undefined): Check {
  if (offer === undefined) return check(null, 'invalid');
  if (offer.bought) return check(null, 'soldOut');
  const def = cardDef(offer.id);
  if (def.requiresMeta !== null && metaLevel(s.meta, def.requiresMeta) < 1)
    return check(offer.price, 'unavailable');
  const stacks = s.players[p].cards[def.bit] ?? 0;
  if (def.unique && stacks > 0) return check(offer.price, 'alreadyOwned');
  if (stacks >= def.stackMax) return check(offer.price, 'maxLevel');
  if (cardIsCapped(s, p, def)) return check(offer.price, 'capped');
  return funds(s, p, offer.price);
}

export function checkRepair(s: ShopState, p: PlayerIndex): Check {
  const player = s.players[p];
  if (player.repairsThisVisit >= REPAIR.maxPerVisit) return check(null, 'visitLimit');
  const price = repairPrice(s.wave, player.repairsThisVisit);
  if (player.hp >= player.maxHp) return check(price, 'fullHp');
  return funds(s, p, price);
}

export function checkTeam(s: ShopState, p: PlayerIndex, id: TeamItemId): Check {
  if (s.mode === 'versus') return check(null, 'unavailable');
  if (s.frameTeamBuys[id] === partnerOf(p)) return check(null, 'soldOut');
  const def = teamItemDef(id);
  const level = s.team.levels[id];
  if (def.holdCap !== null && s.team.kernels >= def.holdCap) return check(null, 'heldCap');
  if (level >= def.maxLevel) return check(null, 'maxLevel');
  if (s.team.boughtThisVisit[id] >= def.perVisit) return check(null, 'visitLimit');
  const price = teamPrice(id, level, s.team.kernelsBoughtThisRun);
  if (price === null) return check(null, 'maxLevel');
  return funds(s, p, price);
}

export function checkReroll(s: ShopState, p: PlayerIndex): Check {
  if (s.freeRerolls[p] > 0) return check(0, null);
  return funds(s, p, rerollPrice(s.rerolls[p], s.wave));
}

export function checkGift(s: ShopState, p: PlayerIndex): Check {
  const amount = UTILITY_PRICES.giftAmount;
  if (s.mode !== 'coop') return check(null, 'unavailable');
  const q = partnerOf(p);
  if (!s.joined[q]) return check(null, 'absent');
  if (s.players[p].wallet < amount) return check(amount, 'funds');
  if (s.players[q].wallet + amount > ECONOMY.WALLET_MAX) return check(amount, 'heldCap');
  return check(amount, null);
}
