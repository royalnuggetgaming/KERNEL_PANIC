/**
 * Run-level contracts: config, flags, summary, shop visit API and the RunSession port.
 * FROZEN after Wave 0.
 */
import type {
  CardId,
  LoadoutPick,
  MetaLevels,
  PlayerIndex,
  RunMode,
  RunOutcome,
  StatRowId,
  TeamItemId,
  ThemeId,
  VehicleId,
} from './ids';
import type { Intents } from './input';
import type { FinalChoice, PurchaseResult, Rarity, ShopTx } from './upgrades';
import type { WorldView } from './world';

export interface RunConfig {
  readonly runId: string;
  readonly seed: number;
  /** solo iff players.length === 1; coop/versus need 2 players. */
  readonly mode: RunMode;
  readonly players: readonly LoadoutPick[];
  /** Firmware snapshot taken at run start; meta purchases never affect a run in progress. */
  readonly meta: MetaLevels;
  readonly autofire: readonly [boolean, boolean];
  readonly focusToggle: readonly [boolean, boolean];
  readonly themeId: ThemeId;
}

export interface RunFlags {
  /** Co-op/solo: push UpgradesShop{midrun}. */
  readonly waveClearReady: boolean;
  /** Co-op/solo: replace with GameOver{defeat}. */
  readonly defeat: boolean;
  /** The shop about to open is the final EXTRACT / PUSH DEEPER visit. */
  readonly finalVisit: boolean;
  /** Versus: push UpgradesShop{midrun} between rounds. */
  readonly roundOver: boolean;
  /** Versus: replace with GameOver{victory}; summary().winner is set. */
  readonly matchOver: boolean;
}

export interface PlayerRunSummary {
  readonly player: PlayerIndex;
  readonly vehicle: VehicleId;
  readonly score: number;
  readonly kills: number;
  readonly damage: number;
  readonly shards: number;
  readonly revives: number;
  readonly bestCombo: number;
  readonly roundWins: number;
}

export interface RunSummary {
  readonly runId: string;
  readonly mode: RunMode;
  readonly outcome: RunOutcome;
  /** Versus match winner; null for co-op/solo and for abandoned/drawn matches. */
  readonly winner: PlayerIndex | null;
  readonly waveReached: number;
  readonly wavesCleared: number;
  readonly bossesKilled: number;
  readonly victoryAchieved: boolean;
  readonly shardsEarnedTotal: number;
  readonly roundsPlayed: number;
  readonly roundWins: readonly [number, number];
  readonly durationS: number;
  readonly totalScore: number;
  readonly players: readonly PlayerRunSummary[];
  readonly mvp: PlayerIndex | null;
}

// ---------------------------------------------------------------- shop visit

export type ShopItemStatus =
  | 'available'
  | 'unaffordable'
  | 'maxed'
  | 'capped'
  | 'soldOut'
  | 'locked'
  | 'owned'
  | 'unavailable'
  | 'heldCap';

export interface ShopRowSnapshot {
  readonly id: StatRowId;
  readonly level: number;
  readonly maxLevel: number;
  /** null when maxed. */
  readonly price: number | null;
  readonly status: ShopItemStatus;
}

export interface ShopCardSnapshot {
  readonly slot: 0 | 1 | 2;
  /** null when the slot was bought this visit. */
  readonly id: CardId | null;
  readonly rarity: Rarity;
  readonly price: number;
  readonly status: ShopItemStatus;
  readonly locked: boolean;
}

export interface ShopTeamSnapshot {
  readonly id: TeamItemId;
  readonly level: number;
  readonly maxLevel: number;
  readonly price: number | null;
  readonly status: ShopItemStatus;
}

export interface ShopPlayerSnapshot {
  readonly player: PlayerIndex;
  readonly joined: boolean;
  readonly vehicle: VehicleId;
  readonly wallet: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly rows: readonly ShopRowSnapshot[];
  readonly repair: {
    readonly price: number | null;
    readonly status: ShopItemStatus;
    readonly boughtThisVisit: number;
  };
  readonly cards: readonly ShopCardSnapshot[];
  /** Team rows priced for THIS player's wallet; status 'unavailable' in versus. */
  readonly team: readonly ShopTeamSnapshot[];
  readonly reroll: { readonly price: number; readonly freeLeft: number };
  readonly gift: { readonly amount: number; readonly status: ShopItemStatus };
  readonly ready: boolean;
  readonly canUndo: boolean;
  readonly lastResult: PurchaseResult | null;
}

export interface ShopVisitSnapshot {
  readonly mode: RunMode;
  readonly wave: number;
  readonly visit: number;
  /** Versus: the round that just finished; 0 otherwise. */
  readonly round: number;
  readonly finalVisit: boolean;
  /** False in versus (team row hidden). */
  readonly teamVisible: boolean;
  /** Co-op only. */
  readonly giftVisible: boolean;
  readonly kernels: number;
  readonly players: readonly [ShopPlayerSnapshot, ShopPlayerSnapshot];
  readonly allReady: boolean;
  /** Remaining ready countdown (1.5 s), null when not counting. */
  readonly countdownMs: number | null;
  readonly choice: FinalChoice | null;
  /** True during the 350 ms open guard. */
  readonly guardActive: boolean;
}

/** A mid-run shop visit (upgrades/ShopModel.ts behind RunSession.openShop()). */
export interface ShopApi {
  /** Re-validates everything. Call P1's transactions before P2's each frame. */
  apply(tx: ShopTx): PurchaseResult;
  /** Advances the open guard and the ready countdown. */
  update(frameDtMs: number): void;
  snapshot(): ShopVisitSnapshot;
  readonly allReady: boolean;
  /** Every joined player Ready and the 1.5 s countdown elapsed (final visit also needs a choice). */
  readonly countdownDone: boolean;
  readonly finalVisit: boolean;
  readonly choice: FinalChoice | null;
  /** Clears undo logs and persists card locks into the run. Called by UpgradesShopState.exit. */
  commit(): void;
}

// ---------------------------------------------------------------- run session

export interface RunSessionApi {
  readonly config: RunConfig;
  readonly world: WorldView;
  readonly flags: RunFlags;
  /** One fixed 1/120 s step. */
  tick(intents: Intents): void;
  openShop(): ShopApi;
  /** After the shop pops: recompute stats (max-HP changes heal by the delta), apply wallets/cards/team. */
  applyShopResults(): void;
  /**
   * Starts the next wave's countdown (co-op/solo; OVERFLOW when PUSH DEEPER was chosen) or the next round
   * (versus). PlayingState.enter calls it once to start wave/round 1. Clears waveClearReady/roundOver.
   */
  beginNextWave(): void;
  clearEvents(): void;
  setViewRect(minX: number, maxX: number, minZ: number, maxZ: number): void;
  summary(outcome: RunOutcome): RunSummary;
  /** Returns pooled entities; the world must not be used afterwards. */
  dispose(): void;
}
