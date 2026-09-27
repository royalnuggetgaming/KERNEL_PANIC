/**
 * A mid-run shop visit (plan section 6 "TRANSACTION RULES"). Pure, no DOM. Every buy, undo, reroll, lock,
 * gift, ready and final choice goes through apply(tx), which re-validates everything. Per-player LIFO logs
 * hold exact snapshots; the team log enforces teamDependency; team stock bought by one player in a frame is
 * soldOut for the partner in that frame (call update() once per frame and apply P1 before P2, or use
 * applyBatch()).
 */
import {
  STAT_ROW_IDS,
  TEAM_ITEM_IDS,
  type MetaLevels,
  type PlayerIndex,
  type RunMode,
  type VehicleId,
} from '../contracts/ids';
import type { ShopApi, ShopVisitSnapshot } from '../contracts/run';
import type { Rng } from '../contracts/sim';
import type { FinalChoice, PlayerRunState, PurchaseResult, ShopTx, TeamState } from '../contracts/upgrades';
import { assertNever } from '../core/assert';
import { META_EFFECTS, metaLevel } from '../config/metaCatalog';
import { UTILITY_PRICES } from '../config/runCatalog';
import type { LockedCard } from './offers';
import { buildSnapshot, type SnapshotCache } from './shopSnapshot';
import {
  allJoinedReady,
  clonePlayer,
  cloneTeam,
  freshTeamFrame,
  initPlayer,
  initTeam,
  success,
  type Ledger,
  type ShopState,
} from './shopState';
import {
  buyCard,
  buyRepair,
  buyRow,
  buyTeam,
  gift,
  lock,
  lockedOf,
  refreshOffers,
  reroll,
  undo,
} from './shopTransactions';
import type { StatCaps } from './stats';

export interface ShopModelInit {
  readonly mode: RunMode;
  readonly wave: number;
  readonly visit: number;
  readonly round: number;
  readonly finalVisit: boolean;
  readonly joined: readonly [boolean, boolean];
  readonly vehicles: readonly [VehicleId, VehicleId];
  /** Copied on init; repairsThisVisit is reset to 0. */
  readonly players: readonly [PlayerRunState, PlayerRunState];
  /** Copied on init; boughtThisVisit is reset to 0. */
  readonly team: TeamState;
  readonly meta: MetaLevels;
  readonly locked: readonly [LockedCard | null, LockedCard | null];
  /** world.rng.shop; offers use rng.fork('shop', visit, player). */
  readonly rng: Rng;
  /** Optional hard-cap override (balancing tools and tests); defaults to config STAT_CAPS. */
  readonly caps?: Partial<StatCaps>;
}

export interface ShopResults {
  readonly players: readonly [PlayerRunState, PlayerRunState];
  readonly team: TeamState;
  readonly locked: readonly [LockedCard | null, LockedCard | null];
  readonly choice: FinalChoice | null;
}

export interface ShopModel extends ShopApi {
  results(): ShopResults;
  /** Applies one frame's transactions P1 first, then P2 (stable within a player). */
  applyBatch(txs: readonly ShopTx[]): PurchaseResult[];
  /** Currency ledger for conservation checks: start - end = spent - refunded - granted (over both wallets). */
  ledger(): Readonly<Ledger>;
  /** Log depth per player (tests and debug overlay). */
  logDepth(p: PlayerIndex): number;
}

const FAIL_INVALID: PurchaseResult = { ok: false, reason: 'invalid' };
const FAIL_ABSENT: PurchaseResult = { ok: false, reason: 'absent' };
const FAIL_GUARD: PurchaseResult = { ok: false, reason: 'guard' };
const FAIL_UNAVAILABLE: PurchaseResult = { ok: false, reason: 'unavailable' };

const ROW_SET: ReadonlySet<string> = new Set(STAT_ROW_IDS);
const TEAM_SET: ReadonlySet<string> = new Set(TEAM_ITEM_IDS);
const CHOICE_SET: ReadonlySet<string> = new Set<FinalChoice>(['extract', 'pushDeeper']);

function isPlayer(p: unknown): p is PlayerIndex {
  return p === 0 || p === 1;
}

function isSlot(n: unknown): n is 0 | 1 | 2 {
  return n === 0 || n === 1 || n === 2;
}

/** Structural validation of a transaction coming from outside (keys, pointer, debug API). */
function wellFormed(tx: ShopTx): boolean {
  if (!isPlayer(tx.player)) return false;
  switch (tx.kind) {
    case 'buyRow':
      return ROW_SET.has(tx.id);
    case 'buyTeam':
      return TEAM_SET.has(tx.id);
    case 'buyCard':
    case 'lock':
      return isSlot(tx.slot);
    case 'choose':
      return CHOICE_SET.has(tx.choice);
    case 'repair':
    case 'reroll':
    case 'undo':
    case 'toggleReady':
    case 'gift':
      return true;
    default:
      return false;
  }
}

function createState(init: ShopModelInit): ShopState {
  const free = metaLevel(init.meta, 'rerollCache') * META_EFFECTS.rerollCachePerLevel;
  const joined: [boolean, boolean] = [init.joined[0], init.joined[1]];
  return {
    mode: init.mode,
    wave: Math.max(1, Math.floor(init.wave)),
    visit: init.visit,
    round: init.round,
    finalVisit: init.finalVisit,
    joined,
    vehicles: [init.vehicles[0], init.vehicles[1]],
    meta: { ...init.meta },
    caps: init.caps,
    players: [initPlayer(init.players[0]), initPlayer(init.players[1])],
    team: initTeam(init.team),
    offers: [[], []],
    offerRng: [
      joined[0] ? init.rng.fork('shop', init.visit, 0) : null,
      joined[1] ? init.rng.fork('shop', init.visit, 1) : null,
    ],
    rerolls: [0, 0],
    freeRerolls: [free, free],
    ready: [false, false],
    choice: null,
    guardMs: UTILITY_PRICES.openGuardMs,
    countdownMs: null,
    countdownDone: false,
    logs: [[], []],
    teamLog: [],
    frameTeamBuys: freshTeamFrame(),
    lastResult: [null, null],
    nextTxId: 1,
    committed: false,
    version: 0,
    ledger: { spent: 0, refunded: 0, granted: 0 },
  };
}

/** Starts, keeps or cancels the ready countdown after a state change. */
function syncCountdown(s: ShopState): void {
  const armed = allJoinedReady(s) && (!s.finalVisit || s.choice !== null);
  if (armed) {
    s.countdownMs ??= UTILITY_PRICES.readyCountdownMs;
    return;
  }
  s.countdownMs = null;
  s.countdownDone = false;
}

function dispatch(s: ShopState, tx: ShopTx): PurchaseResult {
  const p = tx.player;
  if (tx.kind === 'toggleReady') {
    s.ready[p] = !s.ready[p];
    syncCountdown(s);
    return success(0, s.players[p].wallet, s.nextTxId++);
  }
  if (tx.kind === 'choose') {
    if (!s.finalVisit) return FAIL_UNAVAILABLE;
    s.choice = tx.choice;
    syncCountdown(s);
    return success(0, s.players[p].wallet, s.nextTxId++);
  }
  // Everything below changes the build: not while this player is Ready (the countdown may be running).
  if (s.ready[p]) return FAIL_INVALID;
  switch (tx.kind) {
    case 'buyRow':
      return buyRow(s, p, tx, tx.id);
    case 'buyCard':
      return buyCard(s, p, tx, tx.slot);
    case 'buyTeam':
      return buyTeam(s, p, tx, tx.id);
    case 'repair':
      return buyRepair(s, p, tx);
    case 'reroll':
      return reroll(s, p, tx);
    case 'lock':
      return lock(s, p, tx.slot);
    case 'gift':
      return gift(s, p, tx);
    case 'undo':
      return undo(s, p);
    default:
      return assertNever(tx, 'unhandled shop tx');
  }
}

export function createShopModel(init: ShopModelInit): ShopModel {
  const s = createState(init);
  for (let i = 0; i < 2; i++) {
    const p: PlayerIndex = i === 0 ? 0 : 1;
    if (s.joined[p]) refreshOffers(s, p, init.locked[p]);
  }
  const cache: SnapshotCache = { version: -1, players: null };

  const apply = (tx: ShopTx): PurchaseResult => {
    if (s.committed || !wellFormed(tx)) return FAIL_INVALID;
    const p = tx.player;
    if (!s.joined[p]) return FAIL_ABSENT;
    if (s.guardMs > 0) return FAIL_GUARD;
    const res = dispatch(s, tx);
    s.lastResult[p] = res;
    s.version++;
    return res;
  };

  return {
    apply,
    applyBatch(txs: readonly ShopTx[]): PurchaseResult[] {
      const out: PurchaseResult[] = new Array<PurchaseResult>(txs.length);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < txs.length; i++) {
          const tx = txs[i]!;
          const owner = isPlayer(tx.player) ? tx.player : 0;
          if (owner === pass) out[i] = apply(tx);
        }
      }
      return out;
    },
    update(frameDtMs: number): void {
      const dt = Number.isFinite(frameDtMs) && frameDtMs > 0 ? frameDtMs : 0;
      // The same-frame team guard ends with the frame: re-snapshot so the partner no longer sees SOLD OUT.
      let guardEnded = false;
      for (const id of TEAM_ITEM_IDS) {
        if (s.frameTeamBuys[id] !== -1) guardEnded = true;
        s.frameTeamBuys[id] = -1;
      }
      if (guardEnded) s.version++;
      if (s.guardMs > 0) {
        s.guardMs = Math.max(0, s.guardMs - dt);
      }
      syncCountdown(s);
      if (s.countdownMs !== null && !s.countdownDone) {
        s.countdownMs = Math.max(0, s.countdownMs - dt);
        if (s.countdownMs === 0) s.countdownDone = true;
      }
    },
    snapshot(): ShopVisitSnapshot {
      return buildSnapshot(s, cache);
    },
    get allReady(): boolean {
      return allJoinedReady(s);
    },
    get countdownDone(): boolean {
      return s.countdownDone;
    },
    get finalVisit(): boolean {
      return s.finalVisit;
    },
    get choice(): FinalChoice | null {
      return s.choice;
    },
    commit(): void {
      s.logs[0].length = 0;
      s.logs[1].length = 0;
      s.teamLog.length = 0;
      s.committed = true;
      s.version++;
    },
    results(): ShopResults {
      return {
        players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
        team: cloneTeam(s.team),
        locked: [lockedOf(s.offers[0]), lockedOf(s.offers[1])],
        choice: s.choice,
      };
    },
    ledger(): Readonly<Ledger> {
      return { ...s.ledger };
    },
    logDepth(p: PlayerIndex): number {
      return s.logs[p].length;
    },
  };
}
