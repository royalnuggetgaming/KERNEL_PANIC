/**
 * VERSUS mode numbers (docs/ARCHITECTURE.md "Versus addendum"). Consumed by sim/versusRules.ts,
 * WaveDirector (hazard budget), damage (PvP multiplier), ShopModel and rewards.
 */
import { WAVES } from './waves';

export const VERSUS = {
  /** Best of 5: first to 3 round wins. */
  ROUNDS_TO_WIN: 3,
  MAX_ROUNDS: 5,
  /** Draws can leave the score level after round 5: up to 2 tiebreak rounds, then the match is a draw. */
  TIEBREAK_ROUNDS: 2,
  ROUND_TIME: 90,
  SUDDEN_DEATH_TIME: 20,
  /** Sudden death sets every living player's hp to min(hp, this). */
  SUDDEN_DEATH_HP: 1,
  COUNTDOWN: 3,
  ROUND_OUTRO: 2,
  /** PvE hazards spawn at 0.6x the wave threat budget. */
  THREAT_MUL: 0.6,
  /** Player shots/specials damage the opponent at 45% of their enemy damage. */
  PVP_DAMAGE_MUL: 0.45,
  /** Specials (Railburst, Blink mines) hit the opponent at 25% of their enemy damage. */
  PVP_SPECIAL_DAMAGE_MUL: 0.25,
  ROUND_WIN_SHARDS: 40,
  ROUND_LOSS_SHARDS: 60,
  /** Both players on a drawn round. */
  ROUND_DRAW_SHARDS: 40,
  CORES_PER_ROUND_WIN: 5,
  CORES_MATCH_WIN: 10,
  /** Per-profile Cores cap for one versus match. */
  CORES_CAP: 60,
  /** Spawn positions: players start mirrored on the x axis at this distance from the centre. */
  SPAWN_OFFSET: 10,
} as const;

export const PVP_DAMAGE_MUL = VERSUS.PVP_DAMAGE_MUL;

/** Wave-table row used for round r's hazards: w = min(3r - 2, 13), stepping down off boss waves. */
export function versusWaveForRound(round: number): number {
  let w = Math.min(3 * Math.max(1, round) - 2, 13);
  if (w % WAVES.WAVES_PER_SECTOR === 0) w -= 1;
  return w;
}
