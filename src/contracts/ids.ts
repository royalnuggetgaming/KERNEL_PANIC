/**
 * Foundation ids and tiny shared types. Imports nothing.
 * FROZEN after Wave 0: changes go through a CONTRACT CHANGE REQUEST (docs/ARCHITECTURE.md).
 */

export const PLAYER_INDICES = [0, 1] as const;
export type PlayerIndex = (typeof PLAYER_INDICES)[number];

export const RUN_MODES = ['solo', 'coop', 'versus'] as const;
/** solo: P2 absent. coop: 2 players vs the game. versus: 2 players, best of 5 rounds (see ARCHITECTURE.md). */
export type RunMode = (typeof RUN_MODES)[number];

export const VEHICLE_IDS = ['lancer', 'bulwark', 'specter', 'tinker'] as const;
export type VehicleId = (typeof VEHICLE_IDS)[number];

export const ENEMY_KINDS = ['shard', 'dart', 'fork', 'spiker', 'warden', 'leech'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export const BOSS_IDS = ['forkBomb', 'raceCondition', 'kernel'] as const;
export type BossId = (typeof BOSS_IDS)[number];

/** KERNEL PANIC only for v1. More themes are added later as data (see ARCHITECTURE.md "Adding a theme"). */
export const THEME_IDS = ['kernelPanic'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const SPECIAL_KINDS = ['railburst', 'firewall', 'blinkSwarm', 'patchDrone'] as const;
export type SpecialKind = (typeof SPECIAL_KINDS)[number];

export const STAT_ROW_IDS = [
  'thrusters',
  'plating',
  'overclock',
  'payload',
  'magnet',
  'coolant',
  'capacitor',
  'specialTuning',
] as const;
export type StatRowId = (typeof STAT_ROW_IDS)[number];

/** Order is significant: index === CardDef.bit === index into PlayerEntity.cardStacks. */
export const CARD_IDS = [
  'splitShot',
  'overdriveBattery',
  'bounty',
  'pierce',
  'afterimage',
  'doubleBuffer',
  'vampireCode',
  'overheat',
  'ricochet',
  'chainArc',
  'microMissiles',
  'nanoshield',
  'orbitals',
  'glassLens',
  'forkCall',
  'sudo',
  'rootAccess',
  'shardCache',
  'rootOfAllEvil',
] as const;
export type CardId = (typeof CARD_IDS)[number];

export const TEAM_ITEM_IDS = ['spareKernel', 'linkAmp', 'linkRange', 'reviveProtocol'] as const;
export type TeamItemId = (typeof TEAM_ITEM_IDS)[number];

/**
 * Firmware lines. v3 merged Magnet FW + Reroll Cache into Boot Cache and Field Medic into Hull FW (save v2
 * migration refunds their recorded spend, see save/migrations.ts).
 */
export const META_UPGRADE_IDS = [
  'hullFw',
  'overclockFw',
  'bootCache',
  'preCharge',
  'secondBoot',
  'legendaryPool',
] as const;
export type MetaUpgradeId = (typeof META_UPGRADE_IDS)[number];

/** Terminal cheat codes (config/cheats.ts). Cheat runs pay no Cores and never touch records. */
export const CHEAT_IDS = [
  'god',
  'glassCannon',
  'bitRain',
  'turbo',
  'bulletStorm',
  'blinkBlink',
  'fullCharge',
  'mythicStart',
] as const;
export type CheatId = (typeof CHEAT_IDS)[number];

/** Generational pool handle: slot * 256 + (generation & 255). -1 means "none". */
export type EntityHandle = number;
export const NO_HANDLE = -1;

export type RunOutcome = 'defeat' | 'victory' | 'abandoned';

export interface LoadoutPick {
  readonly player: PlayerIndex;
  readonly vehicle: VehicleId;
}

/** Meta firmware levels (missing key = level 0). */
export type MetaLevels = Readonly<Partial<Record<MetaUpgradeId, number>>>;

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Minimal logger port; implementations live in core/logger.ts. */
export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}
