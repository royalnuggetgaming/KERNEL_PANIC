/** Run structure and WaveDirector numbers (plan section 1 "Run structure"). */
import type { BossId } from '../contracts/ids';

export type Formation = 'ring' | 'line' | 'pincer' | 'cluster';

export const WAVES = {
  SECTORS: 3,
  WAVES_PER_SECTOR: 5,
  TOTAL: 15,
  COUNTDOWN: 3,
  DURATION_BASE: 40,
  DURATION_PER_WAVE: 3,
  DURATION_CAP: 70,
  /** round(A + B*w + C*w^2). */
  BUDGET_A: 30,
  BUDGET_B: 14,
  BUDGET_C: 1.8,
  TWO_PLAYER_BUDGET_MUL: 1.5,
  PULSE_INTERVAL: [3.8, 3.5, 3.2],
  MAX_ALIVE: 180,
  HP_GROWTH: 1.07,
  TWO_PLAYER_HP_MUL: 1.2,
  TELEGRAPH: 0.8,
  PURGE_TIME: 1.5,
  PURGE_PAYOUT: 0.5,
  CLEAR_OUTRO: 2,
  SLOWMO_TIME: 0.6,
  SLOWMO_SCALE: 0.35,
  CLEAR_BONUS_BASE: 15,
  CLEAR_BONUS_PER_WAVE: 5,
  OFFLINE_CLEAR_BONUS_MUL: 0.5,
  FORMATIONS: ['ring', 'line', 'pincer', 'cluster'] satisfies readonly Formation[],
  /** Enemies per formation pulse are drawn until the pulse share of the budget is spent. */
  PULSES_PER_WAVE_MIN: 6,
  BOSS_WAVES: [5, 10, 15],
} as const;

export const OVERFLOW = {
  /** +12% enemy HP per OVERFLOW wave (compounding on top of HP_GROWTH^(15-1)). */
  HP_PER_WAVE: 0.12,
  BOSS_EVERY: 5,
  BOSS_CYCLE: ['forkBomb', 'raceCondition', 'kernel'] satisfies readonly BossId[],
} as const;

/** 1-based sector of a global wave index (OVERFLOW waves count as sector 3). */
export function sectorOf(wave: number): 1 | 2 | 3 {
  if (wave <= WAVES.WAVES_PER_SECTOR) return 1;
  if (wave <= WAVES.WAVES_PER_SECTOR * 2) return 2;
  return 3;
}

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % WAVES.WAVES_PER_SECTOR === 0;
}

/** Combat wave duration: 40 s + 3 s x (w - 1), capped at 70 s. */
export function waveDuration(wave: number): number {
  return Math.min(WAVES.DURATION_CAP, WAVES.DURATION_BASE + WAVES.DURATION_PER_WAVE * (wave - 1));
}

/** Threat budget before player-count/mode multipliers: round(30 + 14w + 1.8w^2). */
export function waveBudget(wave: number): number {
  return Math.round(WAVES.BUDGET_A + WAVES.BUDGET_B * wave + WAVES.BUDGET_C * wave * wave);
}

/** Enemy HP multiplier for a wave (before 2P and elite multipliers). */
export function waveHpMul(wave: number): number {
  if (wave <= WAVES.TOTAL) return Math.pow(WAVES.HP_GROWTH, wave - 1);
  const base = Math.pow(WAVES.HP_GROWTH, WAVES.TOTAL - 1);
  return base * Math.pow(1 + OVERFLOW.HP_PER_WAVE, wave - WAVES.TOTAL);
}

export function pulseInterval(wave: number): number {
  return WAVES.PULSE_INTERVAL[sectorOf(wave) - 1] ?? WAVES.PULSE_INTERVAL[0];
}

/** Boss for a boss wave (OVERFLOW cycles through the 3 bosses), null otherwise. */
export function bossForWave(wave: number): BossId | null {
  if (!isBossWave(wave)) return null;
  if (wave <= WAVES.TOTAL) {
    const idx = wave / WAVES.WAVES_PER_SECTOR - 1;
    return OVERFLOW.BOSS_CYCLE[idx] ?? null;
  }
  const n = (wave - WAVES.TOTAL) / OVERFLOW.BOSS_EVERY - 1;
  return OVERFLOW.BOSS_CYCLE[n % OVERFLOW.BOSS_CYCLE.length] ?? null;
}

/** Wave-clear Shards bonus per player: 15 + 5w. */
export function clearBonus(wave: number): number {
  return WAVES.CLEAR_BONUS_BASE + WAVES.CLEAR_BONUS_PER_WAVE * wave;
}
