/**
 * Difficulty multipliers applied on top of the (NORMAL) numbers in enemies.ts, waves.ts, bosses.ts and
 * versus.ts. The difficulty is snapshotted into RunConfig at run start (like the Firmware levels) and copied to
 * WorldConfig, so it never changes mid-run. NORMAL is exactly 1 everywhere; HARD approximates the v1 release
 * numbers (NORMAL was derived from v1 by roughly /speed, /budget, /damage below); CASUAL is gentler still.
 *
 * - speed:  enemy move speed and Dart lunge speed (bullets and bosses keep their own speeds).
 * - budget: wave threat budget (enemy count), co-op/solo and versus hazards alike.
 * - damage: every non-player damage to players (contact, bullets, lasers, boss charges).
 * - hp:     enemy and boss HP (on top of the wave / 2P / elite multipliers).
 * Cores rewards are not scaled by difficulty.
 */
import type { DifficultyId } from '../contracts/save';

export interface DifficultyDef {
  readonly id: DifficultyId;
  readonly speed: number;
  readonly budget: number;
  readonly damage: number;
  readonly hp: number;
}

export const DIFFICULTY = {
  casual: { id: 'casual', speed: 0.8, budget: 0.7, damage: 0.6, hp: 0.8 },
  normal: { id: 'normal', speed: 1, budget: 1, damage: 1, hp: 1 },
  hard: { id: 'hard', speed: 1.35, budget: 1.75, damage: 1.75, hp: 1.25 },
} as const satisfies Readonly<Record<DifficultyId, DifficultyDef>>;

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

/** Multipliers of a difficulty; absent (old saves, fixtures) means NORMAL. */
export function difficultyDef(id: DifficultyId | undefined): DifficultyDef {
  return DIFFICULTY[id ?? DEFAULT_DIFFICULTY];
}
