/**
 * Internal state of a mid-run shop visit plus the small pure helpers shared by ShopModel.ts,
 * shopTransactions.ts and shopSnapshot.ts. Not part of the public API.
 */
import {
  CARD_IDS,
  STAT_ROW_IDS,
  TEAM_ITEM_IDS,
  type CardId,
  type MetaLevels,
  type PlayerIndex,
  type RunMode,
  type StatRowId,
  type TeamItemId,
  type VehicleId,
} from '../contracts/ids';
import type { Rng } from '../contracts/sim';
import type {
  DerivedStats,
  FinalChoice,
  PlayerRunState,
  PurchaseResult,
  StatModifier,
  TeamSnapshot,
  TeamState,
  TxLogEntry,
} from '../contracts/upgrades';
import { devAssert, isNonNegativeSafeInt } from '../core/assert';
import { ECONOMY } from '../config/tuning';
import { computeStats, type StatCaps } from './stats';

export interface OfferSlot {
  id: CardId;
  price: number;
  locked: boolean;
  bought: boolean;
}

/** A log entry plus the extra bookkeeping undo needs beyond the contract's TxLogEntry. */
export interface LogRecord {
  readonly entry: TxLogEntry;
  /** Card buys: the slot bought and whether it was locked at the time. */
  readonly slot: number;
  readonly slotWasLocked: boolean;
  /** Shards credited by the purchase itself (Shard Cache); removed again on undo. */
  readonly grant: number;
}

export interface Ledger {
  spent: number;
  refunded: number;
  granted: number;
}

export interface ShopState {
  readonly mode: RunMode;
  readonly wave: number;
  readonly visit: number;
  readonly round: number;
  readonly finalVisit: boolean;
  readonly joined: readonly [boolean, boolean];
  readonly vehicles: readonly [VehicleId, VehicleId];
  readonly meta: MetaLevels;
  readonly caps: Partial<StatCaps> | undefined;
  /** Run-wide stat extras (TERMINAL cheats). */
  readonly extraMods: readonly StatModifier[] | undefined;
  readonly players: [PlayerRunState, PlayerRunState];
  team: TeamState;
  readonly offers: [OfferSlot[], OfferSlot[]];
  readonly offerRng: [Rng | null, Rng | null];
  /** Per-player Mythic roll stream (forked apart from offerRng). */
  readonly mythicRng: [Rng | null, Rng | null];
  /** Paid rerolls this visit (price escalation). */
  readonly rerolls: [number, number];
  readonly freeRerolls: [number, number];
  readonly ready: [boolean, boolean];
  choice: FinalChoice | null;
  guardMs: number;
  countdownMs: number | null;
  countdownDone: boolean;
  readonly logs: [LogRecord[], LogRecord[]];
  /** Tx ids of team purchases, oldest first. */
  readonly teamLog: number[];
  /** Team items bought during the current frame (soldOut for the partner in the same frame). */
  readonly frameTeamBuys: Record<TeamItemId, PlayerIndex | -1>;
  readonly lastResult: [PurchaseResult | null, PurchaseResult | null];
  nextTxId: number;
  committed: boolean;
  /** Bumped on every state change (snapshot cache key). */
  version: number;
  readonly ledger: Ledger;
}

export function clonePlayer(p: Readonly<PlayerRunState>): PlayerRunState {
  const rows = {} as Record<StatRowId, number>;
  for (const id of STAT_ROW_IDS) rows[id] = p.rows[id];
  const cards = new Uint8Array(CARD_IDS.length);
  cards.set(p.cards.subarray(0, CARD_IDS.length));
  return {
    wallet: p.wallet,
    hp: p.hp,
    maxHp: p.maxHp,
    rows,
    cards,
    repairsThisVisit: p.repairsThisVisit,
  };
}

function teamRecord(src: Readonly<Record<TeamItemId, number>>): Record<TeamItemId, number> {
  const out = {} as Record<TeamItemId, number>;
  for (const id of TEAM_ITEM_IDS) out[id] = src[id];
  return out;
}

export function cloneTeam(t: Readonly<TeamState> | TeamSnapshot): TeamState {
  return {
    kernels: t.kernels,
    kernelsBoughtThisRun: t.kernelsBoughtThisRun,
    levels: teamRecord(t.levels),
    boughtThisVisit: teamRecord(t.boughtThisVisit),
  };
}

function sanitizeCount(n: number, what: string): number {
  devAssert(isNonNegativeSafeInt(n), `shop init: ${what} must be a non-negative safe integer (got ${n})`);
  return isNonNegativeSafeInt(n) ? n : 0;
}

/** Validates (DEV assert) and coerces an incoming player state; the visit counters start at 0. */
export function initPlayer(p: Readonly<PlayerRunState>): PlayerRunState {
  const c = clonePlayer(p);
  c.wallet = Math.min(ECONOMY.WALLET_MAX, sanitizeCount(c.wallet, 'wallet'));
  c.hp = Number.isFinite(c.hp) && c.hp > 0 ? c.hp : 0;
  c.maxHp = Number.isFinite(c.maxHp) && c.maxHp >= 1 ? c.maxHp : 1;
  for (const id of STAT_ROW_IDS) c.rows[id] = sanitizeCount(c.rows[id], `rows.${id}`);
  c.repairsThisVisit = 0;
  return c;
}

export function initTeam(t: Readonly<TeamState>): TeamState {
  const c = cloneTeam(t);
  c.kernels = sanitizeCount(c.kernels, 'kernels');
  c.kernelsBoughtThisRun = sanitizeCount(c.kernelsBoughtThisRun, 'kernelsBoughtThisRun');
  for (const id of TEAM_ITEM_IDS) {
    c.levels[id] = sanitizeCount(c.levels[id], `team.${id}`);
    c.boughtThisVisit[id] = 0;
  }
  return c;
}

export function statsOf(s: ShopState, p: PlayerIndex, player: Readonly<PlayerRunState>): DerivedStats {
  return computeStats(s.vehicles[p], s.meta, player.rows, player.cards, s.team.levels, s.caps, s.extraMods);
}

/**
 * Applies a max-HP change: increases heal by the delta, decreases clamp current HP (never below 1).
 */
export function applyMaxHp(player: PlayerRunState, before: number, after: number): void {
  const delta = after - before;
  player.maxHp = after;
  if (delta > 0) player.hp = Math.min(after, player.hp + delta);
  else if (delta < 0) player.hp = Math.max(1, Math.min(player.hp, after));
}

/** Credits a wallet, clamped to WALLET_MAX; returns the credited amount. */
export function credit(player: PlayerRunState, amount: number): number {
  const room = ECONOMY.WALLET_MAX - player.wallet;
  const c = Math.max(0, Math.min(room, amount));
  player.wallet += c;
  return c;
}

export function partnerOf(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

export function success(price: number, balance: number, txId: number): PurchaseResult {
  devAssert(isNonNegativeSafeInt(price) && isNonNegativeSafeInt(balance), 'shop: non-integer currency');
  return { ok: true, price, balance, txId };
}

export function freshTeamFrame(): Record<TeamItemId, PlayerIndex | -1> {
  const out = {} as Record<TeamItemId, PlayerIndex | -1>;
  for (const id of TEAM_ITEM_IDS) out[id] = -1;
  return out;
}

export function allJoinedReady(s: ShopState): boolean {
  let any = false;
  for (let p = 0; p < 2; p++) {
    if (!s.joined[p]) continue;
    any = true;
    if (!s.ready[p]) return false;
  }
  return any;
}
