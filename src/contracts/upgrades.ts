/**
 * Upgrade, stat and shop-transaction contracts. FROZEN after Wave 0.
 */
import type { CardId, MetaUpgradeId, PlayerIndex, StatRowId, TeamItemId } from './ids';

export const NUMERIC_STATS = [
  'maxHp',
  'moveSpeed',
  'fireRate',
  'damageMul',
  'projectiles',
  'spreadDeg',
  'pierce',
  'bounces',
  'projectileSpeed',
  'critChance',
  'magnetRadius',
  'dashCooldown',
  'dashCharges',
  'specialChargeMul',
  'specialTier',
  'shardGain',
  'linkDps',
  'linkRange',
  'reviveTime',
  'reviveHpFrac',
  'armor',
] as const;
export type NumericStat = (typeof NUMERIC_STATS)[number];

/** Final per-player stats (after stacking and hard caps). Recomputed only at run start, shop exit or on events. */
export type DerivedStats = Record<NumericStat, number>;

/**
 * stat = clamp((base + sum(flat)) * (1 + sum(add)) * product(mul), min, max).
 * `add` values are fractions (0.07 = +7%).
 */
export interface StatModifier {
  readonly stat: NumericStat;
  readonly op: 'flat' | 'add' | 'mul';
  readonly value: number;
}

export interface StatRowDef {
  readonly id: StatRowId;
  readonly label: string;
  readonly blurb: string;
  readonly maxLevel: number;
  /** price = max(5, round5(base * growth^level * waveInflation(w))). */
  readonly base: number;
  readonly growth: number;
  readonly perLevel: readonly StatModifier[];
}

export type Rarity = 'C' | 'U' | 'R' | 'L';

export interface CardDef {
  readonly id: CardId;
  /** Index into CARD_IDS / PlayerEntity.cardStacks and bit in PlayerEntity.cardMask. */
  readonly bit: number;
  readonly label: string;
  readonly blurb: string;
  readonly rarity: Rarity;
  readonly stackMax: number;
  readonly unique: boolean;
  /** Meta upgrade that must be >= 1 for this card to be offered (Legendary Pool). null = always. */
  readonly requiresMeta: MetaUpgradeId | null;
  readonly modifiers: readonly StatModifier[];
  /** CARD_EFFECT bit (config/cards.ts) for per-tick behaviours, 0 for pure stat cards. */
  readonly effectFlag: number;
}

export interface TeamItemDef {
  readonly id: TeamItemId;
  readonly label: string;
  readonly blurb: string;
  /** Explicit price per level, or 'kernel' = 150 * (1 + 0.5 * boughtThisRun). */
  readonly prices: readonly number[] | 'kernel';
  readonly maxLevel: number;
  readonly perVisit: number;
  /** Hold cap for consumable stock (Spare Kernel = 3); null = none. */
  readonly holdCap: number | null;
  /** Applied to BOTH players per level. */
  readonly modifiers: readonly StatModifier[];
}

export interface MetaUpgradeDef {
  readonly id: MetaUpgradeId;
  readonly label: string;
  readonly blurb: string;
  /** prices[level] is the price to go from `level` to `level + 1`; maxLevel = prices.length. */
  readonly prices: readonly number[];
  readonly modifiers: readonly StatModifier[];
}

/** Per-player economy state used by the shop. Snapshots are deep copies (cards copied). */
export interface PlayerRunState {
  wallet: number;
  hp: number;
  maxHp: number;
  rows: Record<StatRowId, number>;
  /** Stack counts indexed by CardDef.bit (length CARD_IDS.length). */
  cards: Uint8Array;
  repairsThisVisit: number;
}

/** Shared team stock (co-op/solo). Unused in versus. */
export interface TeamState {
  kernels: number;
  kernelsBoughtThisRun: number;
  levels: Record<TeamItemId, number>;
  boughtThisVisit: Record<TeamItemId, number>;
}

export type FinalChoice = 'extract' | 'pushDeeper';

export type ShopTx =
  | { readonly kind: 'buyRow'; readonly player: PlayerIndex; readonly id: StatRowId }
  | { readonly kind: 'buyCard'; readonly player: PlayerIndex; readonly slot: 0 | 1 | 2 }
  | { readonly kind: 'buyTeam'; readonly player: PlayerIndex; readonly id: TeamItemId }
  | { readonly kind: 'repair'; readonly player: PlayerIndex }
  | { readonly kind: 'reroll'; readonly player: PlayerIndex }
  | { readonly kind: 'undo'; readonly player: PlayerIndex }
  | { readonly kind: 'toggleReady'; readonly player: PlayerIndex }
  | { readonly kind: 'lock'; readonly player: PlayerIndex; readonly slot: 0 | 1 | 2 }
  | { readonly kind: 'gift'; readonly player: PlayerIndex }
  | { readonly kind: 'choose'; readonly player: PlayerIndex; readonly choice: FinalChoice };

export type PurchaseFailure =
  | 'funds'
  | 'maxLevel'
  | 'capped'
  | 'soldOut'
  | 'unavailable'
  | 'absent'
  | 'fullHp'
  | 'visitLimit'
  | 'heldCap'
  | 'alreadyOwned'
  | 'nothingToUndo'
  | 'teamDependency'
  | 'guard'
  | 'invalid';

export type PurchaseResult =
  | { readonly ok: true; readonly price: number; readonly balance: number; readonly txId: number }
  | { readonly ok: false; readonly reason: PurchaseFailure };

export interface TeamSnapshot {
  readonly kernels: number;
  readonly kernelsBoughtThisRun: number;
  readonly levels: Readonly<Record<TeamItemId, number>>;
  readonly boughtThisVisit: Readonly<Record<TeamItemId, number>>;
}

export interface TxLogEntry {
  readonly id: number;
  readonly actor: PlayerIndex;
  readonly tx: ShopTx;
  readonly pricePaid: number;
  readonly snapshot: PlayerRunState;
  /** Gift: the receiver's snapshot so undo is exact. */
  readonly partnerSnapshot: PlayerRunState | null;
  readonly teamSnapshot: TeamSnapshot | null;
  readonly refundable: boolean;
}
