/**
 * Mutating shop transaction handlers. ShopModel.apply has already checked the envelope (shape, joined,
 * open guard, ready); each handler re-validates its own rules through shopChecks.ts before mutating.
 */
import type { PlayerIndex, StatRowId, TeamItemId } from '../contracts/ids';
import type {
  PlayerRunState,
  PurchaseFailure,
  PurchaseResult,
  ShopTx,
  TeamSnapshot,
} from '../contracts/upgrades';
import { CARD_PARAMS, cardDef } from '../config/cards';
import { metaLevel } from '../config/metaCatalog';
import { REPAIR } from '../config/runCatalog';
import { sectorOf } from '../config/waves';
import { drawOffers, type LockedCard } from './offers';
import {
  checkCard,
  checkGift,
  checkRepair,
  checkReroll,
  checkRow,
  checkTeam,
  type Check,
} from './shopChecks';
import {
  applyMaxHp,
  clonePlayer,
  cloneTeam,
  credit,
  partnerOf,
  statsOf,
  success,
  type LogRecord,
  type OfferSlot,
  type ShopState,
} from './shopState';

interface RecordOpts {
  readonly partner?: PlayerRunState;
  readonly team?: TeamSnapshot;
  readonly refundable?: boolean;
  readonly slot?: number;
  readonly slotWasLocked?: boolean;
  readonly grant?: number;
}

function fail(reason: PurchaseFailure): PurchaseResult {
  return { ok: false, reason };
}

/** Appends a log record for the actor and returns the success result. */
function record(
  s: ShopState,
  p: PlayerIndex,
  tx: ShopTx,
  price: number,
  snapshot: PlayerRunState,
  opts: RecordOpts = {},
): PurchaseResult & { readonly ok: true } {
  const id = s.nextTxId++;
  const rec: LogRecord = {
    entry: {
      id,
      actor: p,
      tx,
      pricePaid: price,
      snapshot,
      partnerSnapshot: opts.partner ?? null,
      teamSnapshot: opts.team ?? null,
      refundable: opts.refundable ?? true,
    },
    slot: opts.slot ?? -1,
    slotWasLocked: opts.slotWasLocked ?? false,
    grant: opts.grant ?? 0,
  };
  s.logs[p].push(rec);
  s.version++;
  return { ok: true, price, balance: s.players[p].wallet, txId: id };
}

function charge(s: ShopState, p: PlayerIndex, price: number): void {
  s.players[p].wallet -= price;
  s.ledger.spent += price;
}

function priced(c: Check): number {
  return c.price ?? 0;
}

export function buyRow(s: ShopState, p: PlayerIndex, tx: ShopTx, id: StatRowId): PurchaseResult {
  const c = checkRow(s, p, id);
  if (c.fail !== null) return fail(c.fail);
  const player = s.players[p];
  const snapshot = clonePlayer(player);
  const before = statsOf(s, p, player).maxHp;
  charge(s, p, priced(c));
  player.rows[id]++;
  applyMaxHp(player, before, statsOf(s, p, player).maxHp);
  return record(s, p, tx, priced(c), snapshot);
}

export function buyCard(s: ShopState, p: PlayerIndex, tx: ShopTx, slot: number): PurchaseResult {
  const offer = s.offers[p][slot];
  const c = checkCard(s, p, offer);
  if (offer === undefined) return fail('invalid');
  if (c.fail !== null) return fail(c.fail);
  const player = s.players[p];
  const snapshot = clonePlayer(player);
  const price = priced(c);
  const slotWasLocked = offer.locked;
  charge(s, p, price);
  offer.bought = true;
  offer.locked = false;
  let grant = 0;
  if (offer.id === 'shardCache') {
    grant = credit(player, CARD_PARAMS.shardCache.shards);
    s.ledger.granted += grant;
  } else {
    const def = cardDef(offer.id);
    const before = statsOf(s, p, player).maxHp;
    player.cards[def.bit] = (player.cards[def.bit] ?? 0) + 1;
    applyMaxHp(player, before, statsOf(s, p, player).maxHp);
  }
  return record(s, p, tx, price, snapshot, { slot, slotWasLocked, grant });
}

export function buyRepair(s: ShopState, p: PlayerIndex, tx: ShopTx): PurchaseResult {
  const c = checkRepair(s, p);
  if (c.fail !== null) return fail(c.fail);
  const player = s.players[p];
  const snapshot = clonePlayer(player);
  charge(s, p, priced(c));
  player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * REPAIR.healFrac));
  player.repairsThisVisit++;
  return record(s, p, tx, priced(c), snapshot);
}

/** Team items only touch link/revive stats (never max HP), so the players' hp needs no adjustment. */
export function buyTeam(s: ShopState, p: PlayerIndex, tx: ShopTx, id: TeamItemId): PurchaseResult {
  const c = checkTeam(s, p, id);
  if (c.fail !== null) return fail(c.fail);
  const snapshot = clonePlayer(s.players[p]);
  const team = cloneTeam(s.team);
  charge(s, p, priced(c));
  const t = s.team;
  if (id === 'spareKernel') {
    t.kernels++;
    t.kernelsBoughtThisRun++;
  } else {
    t.levels[id]++;
  }
  t.boughtThisVisit[id]++;
  s.frameTeamBuys[id] = p;
  const res = record(s, p, tx, priced(c), snapshot, { team });
  s.teamLog.push(res.txId);
  return res;
}

export function gift(s: ShopState, p: PlayerIndex, tx: ShopTx): PurchaseResult {
  const c = checkGift(s, p);
  if (c.fail !== null) return fail(c.fail);
  const q = partnerOf(p);
  const amount = priced(c);
  const snapshot = clonePlayer(s.players[p]);
  const partner = clonePlayer(s.players[q]);
  // A transfer: the wallet total is conserved, so the ledger does not move.
  s.players[p].wallet -= amount;
  s.players[q].wallet += amount;
  return record(s, p, tx, amount, snapshot, { partner });
}

export function lockedOf(slots: readonly OfferSlot[]): LockedCard | null {
  for (const o of slots) if (o.locked && !o.bought) return { id: o.id, price: o.price };
  return null;
}

/** Draws a fresh set of offers for a player (keeping a locked card) into s.offers[p]. */
export function refreshOffers(s: ShopState, p: PlayerIndex, locked: LockedCard | null): void {
  const rng = s.offerRng[p];
  const slots = s.offers[p];
  slots.length = 0;
  if (rng === null) return;
  const offers = drawOffers(rng, {
    sector: sectorOf(s.wave),
    wave: s.wave,
    owned: s.players[p].cards,
    legendaryPool: metaLevel(s.meta, 'legendaryPool') >= 1,
    locked,
  });
  for (const o of offers) slots.push({ id: o.id, price: o.price, locked: o.locked, bought: false });
}

export function reroll(s: ShopState, p: PlayerIndex, tx: ShopTx): PurchaseResult {
  const c = checkReroll(s, p);
  if (c.fail !== null) return fail(c.fail);
  const snapshot = clonePlayer(s.players[p]);
  const price = priced(c);
  if (s.freeRerolls[p] > 0) s.freeRerolls[p]--;
  else s.rerolls[p]++;
  charge(s, p, price);
  refreshOffers(s, p, lockedOf(s.offers[p]));
  // Rerolls are never refundable: the entry is an undo barrier.
  return record(s, p, tx, price, snapshot, { refundable: false });
}

/** Toggles the lock on a slot; locking another slot moves the single lock. */
export function lock(s: ShopState, p: PlayerIndex, slot: number): PurchaseResult {
  const slots = s.offers[p];
  const target = slots[slot];
  if (target === undefined || target.bought || target.id === 'shardCache') return fail('invalid');
  const wasLocked = target.locked;
  for (const o of slots) o.locked = false;
  target.locked = !wasLocked;
  s.version++;
  return success(0, s.players[p].wallet, s.nextTxId++);
}

export function canUndo(s: ShopState, p: PlayerIndex): boolean {
  const log = s.logs[p];
  return log[log.length - 1]?.entry.refundable === true;
}

export function undo(s: ShopState, p: PlayerIndex): PurchaseResult {
  const log = s.logs[p];
  const rec = log[log.length - 1];
  if (rec?.entry.refundable !== true) return fail('nothingToUndo');
  const e = rec.entry;
  const player = s.players[p];
  if (e.teamSnapshot !== null && s.teamLog[s.teamLog.length - 1] !== e.id) return fail('teamDependency');
  if (e.tx.kind === 'gift') {
    const q = partnerOf(p);
    if (s.players[q].wallet < e.pricePaid) return fail('teamDependency');
    s.players[q].wallet -= e.pricePaid;
    player.wallet += e.pricePaid;
  } else {
    if (player.wallet + e.pricePaid < rec.grant) return fail('teamDependency');
    const snap = e.snapshot;
    player.wallet = player.wallet + e.pricePaid - rec.grant;
    player.hp = snap.hp;
    player.maxHp = snap.maxHp;
    player.cards.set(snap.cards);
    Object.assign(player.rows, snap.rows);
    player.repairsThisVisit = snap.repairsThisVisit;
    s.ledger.refunded += e.pricePaid;
    s.ledger.granted -= rec.grant;
    if (e.teamSnapshot !== null) {
      s.teamLog.pop();
      s.team = cloneTeam(e.teamSnapshot);
      if (e.tx.kind === 'buyTeam' && s.frameTeamBuys[e.tx.id] === p) s.frameTeamBuys[e.tx.id] = -1;
    }
    const slot = s.offers[p][rec.slot];
    if (slot !== undefined) {
      let otherLocked = false;
      for (const o of s.offers[p]) if (o.locked) otherLocked = true;
      slot.bought = false;
      slot.locked = rec.slotWasLocked && !otherLocked;
    }
  }
  log.pop();
  s.version++;
  return success(e.pricePaid, player.wallet, e.id);
}
