/** Builds the ShopVisitSnapshot view of a shop visit from its internal state (read-only). */
import { STAT_ROW_IDS, TEAM_ITEM_IDS, type PlayerIndex } from '../contracts/ids';
import type {
  ShopCardSnapshot,
  ShopItemStatus,
  ShopPlayerSnapshot,
  ShopRowSnapshot,
  ShopTeamSnapshot,
  ShopVisitSnapshot,
} from '../contracts/run';
import type { PurchaseFailure } from '../contracts/upgrades';
import { cardDef } from '../config/cards';
import { REPAIR, UTILITY_PRICES, statRowDef, teamItemDef } from '../config/runCatalog';
import {
  checkCard,
  checkGift,
  checkRepair,
  checkReroll,
  checkRow,
  checkTeam,
  type Check,
} from './shopChecks';
import { canUndo } from './shopTransactions';
import { allJoinedReady, type ShopState } from './shopState';

/** Maps a validation failure to the status a row displays. */
export function statusOf(fail: PurchaseFailure | null): ShopItemStatus {
  switch (fail) {
    case null:
      return 'available';
    case 'funds':
      return 'unaffordable';
    case 'maxLevel':
    case 'fullHp':
      return 'maxed';
    case 'capped':
      return 'capped';
    case 'soldOut':
    case 'visitLimit':
      return 'soldOut';
    case 'alreadyOwned':
      return 'owned';
    case 'heldCap':
      return 'heldCap';
    case 'unavailable':
    case 'absent':
    case 'guard':
    case 'invalid':
    case 'nothingToUndo':
    case 'teamDependency':
      return 'unavailable';
  }
}

function rowStatus(c: Check): { price: number | null; status: ShopItemStatus } {
  return { price: c.price, status: statusOf(c.fail) };
}

function playerSnapshot(s: ShopState, p: PlayerIndex): ShopPlayerSnapshot {
  const player = s.players[p];
  const rows: ShopRowSnapshot[] = [];
  for (const id of STAT_ROW_IDS) {
    rows.push({ id, level: player.rows[id], maxLevel: statRowDef(id).maxLevel, ...rowStatus(checkRow(s, p, id)) });
  }
  const cards: ShopCardSnapshot[] = [];
  const slots = s.offers[p];
  for (let i = 0; i < slots.length; i++) {
    const o = slots[i]!;
    const slot: 0 | 1 | 2 = i === 0 ? 0 : i === 1 ? 1 : 2;
    cards.push({
      slot,
      id: o.bought ? null : o.id,
      rarity: cardDef(o.id).rarity,
      price: o.price,
      status: statusOf(checkCard(s, p, o).fail),
      locked: o.locked,
    });
  }
  const team: ShopTeamSnapshot[] = [];
  for (const id of TEAM_ITEM_IDS) {
    const def = teamItemDef(id);
    team.push({
      id,
      level: id === 'spareKernel' ? s.team.kernels : s.team.levels[id],
      maxLevel: def.holdCap ?? def.maxLevel,
      ...rowStatus(checkTeam(s, p, id)),
    });
  }
  const repair = checkRepair(s, p);
  const reroll = checkReroll(s, p);
  return {
    player: p,
    joined: s.joined[p],
    vehicle: s.vehicles[p],
    wallet: player.wallet,
    hp: player.hp,
    maxHp: player.maxHp,
    rows,
    repair: {
      price: player.repairsThisVisit >= REPAIR.maxPerVisit ? null : repair.price,
      status: statusOf(repair.fail),
      boughtThisVisit: player.repairsThisVisit,
    },
    cards,
    team,
    reroll: { price: reroll.price ?? 0, freeLeft: s.freeRerolls[p] },
    gift: { amount: UTILITY_PRICES.giftAmount, status: statusOf(checkGift(s, p).fail) },
    ready: s.ready[p],
    canUndo: canUndo(s, p),
    lastResult: s.lastResult[p],
  };
}

/** Per-player parts are cached by state version; the top level is rebuilt so timers stay live. */
export interface SnapshotCache {
  version: number;
  players: readonly [ShopPlayerSnapshot, ShopPlayerSnapshot] | null;
}

export function buildSnapshot(s: ShopState, cache: SnapshotCache): ShopVisitSnapshot {
  if (cache.players === null || cache.version !== s.version) {
    cache.players = [playerSnapshot(s, 0), playerSnapshot(s, 1)];
    cache.version = s.version;
  }
  return {
    mode: s.mode,
    wave: s.wave,
    visit: s.visit,
    round: s.mode === 'versus' ? s.round : 0,
    finalVisit: s.finalVisit,
    teamVisible: s.mode !== 'versus',
    giftVisible: s.mode === 'coop',
    kernels: s.team.kernels,
    players: cache.players,
    allReady: allJoinedReady(s),
    countdownMs: s.countdownMs,
    choice: s.choice,
    guardActive: s.guardMs > 0,
  };
}
