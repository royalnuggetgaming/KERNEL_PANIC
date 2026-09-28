/**
 * WaveDirector: pure wave plans (threat budget, duration, pulses, unlocks, boss, HP scaling) and the per-tick
 * pulse scheduler that spends the budget in formations at the 3 portals farthest from the players, behind
 * 0.8 s telegraphs, never exceeding 180 alive enemies (enemies + pending telegraphs). Budget that does not
 * fit under the cap stays in budgetLeft and is spent by later pulses (deferral).
 */
import { ENEMY_KINDS, type BossId, type EnemyKind, type RunMode } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type { DifficultyId } from '../contracts/save';
import type { SimSystem, WorldState } from '../contracts/world';
import { BOSS_COMMON } from '../config/bosses';
import { DEFAULT_DIFFICULTY, difficultyDef } from '../config/difficulty';
import { ENEMY_DEFS, eliteChance } from '../config/enemies';
import { ARENA } from '../config/tuning';
import { VERSUS } from '../config/versus';
import { WAVES, bossForWave, pulseInterval, waveBudget, waveDuration, waveHpMul } from '../config/waves';
import { spawnBoss } from '../entities/bosses';
import { emitTelegraph } from '../entities/contentShared';
import { choosePortals, formationPoint, portalPosition } from './formations';

export interface WavePlan {
  readonly wave: number;
  readonly budget: number; // after playerCount/mode multipliers
  readonly duration: number;
  readonly pulseInterval: number;
  readonly unlocked: readonly EnemyKind[];
  readonly boss: BossId | null;
  readonly hpMul: number;
  readonly threatMul: number;
}

/** Budget is spread over pulses covering this fraction of the wave, leaving time to finish the last pulse. */
export const SPAWN_WINDOW = 0.75;
/** First pulse this long after combat starts. */
export const FIRST_PULSE_DELAY = 0.5;
/** Relative pick weights per kind (ENEMY_KINDS order): fodder is common, specialists rarer. */
export const KIND_WEIGHTS: readonly number[] = [6, 4, 3, 2, 2, 2];
/** Portal warning ring size. */
const PORTAL_TELEGRAPH_SIZE = 4;

/** Kinds unlocked at a wave, in ENEMY_KINDS order. */
export function unlockedKinds(wave: number): readonly EnemyKind[] {
  const out: EnemyKind[] = [];
  for (const k of ENEMY_KINDS) if (ENEMY_DEFS[k].unlockWave <= wave) out.push(k);
  return out;
}

/** Threat multiplier: versus 0.6 (2 players, no 2P bonus), 2P x1.5, solo x1. */
export function threatMulFor(playerCount: 1 | 2, mode: RunMode): number {
  if (mode === 'versus') return VERSUS.THREAT_MUL;
  return playerCount === 2 ? WAVES.TWO_PLAYER_BUDGET_MUL : 1;
}

/** Enemy HP multiplier fixed at wave start: 1.07^(w-1) (OVERFLOW +12%/wave), x1.2 with 2 players. */
export function hpMulFor(wave: number, playerCount: 1 | 2): number {
  return waveHpMul(wave) * (playerCount === 2 ? WAVES.TWO_PLAYER_HP_MUL : 1);
}

/**
 * Pure. mode 'versus' => THREAT_MUL and never a boss. The difficulty scales the budget (enemy count) and the
 * enemy HP multiplier; threatMul stays the player-count/mode multiplier.
 */
export function generateWavePlan(
  wave: number,
  playerCount: 1 | 2,
  mode: RunMode,
  difficulty: DifficultyId = DEFAULT_DIFFICULTY,
): WavePlan {
  const diff = difficultyDef(difficulty);
  const threatMul = threatMulFor(playerCount, mode);
  const boss = mode === 'versus' ? null : bossForWave(wave);
  let duration = waveDuration(wave);
  if (mode === 'versus') duration = VERSUS.ROUND_TIME;
  else if (boss !== null) duration = BOSS_COMMON.ENRAGE_AT;
  return {
    wave,
    budget: Math.round(waveBudget(wave) * threatMul * diff.budget),
    duration,
    pulseInterval: pulseInterval(wave),
    unlocked: unlockedKinds(wave),
    boss,
    hpMul: hpMulFor(wave, playerCount) * diff.hp,
    threatMul,
  };
}

/** Number of pulses the budget is split over for a wave of `duration` seconds. */
export function pulseCount(duration: number, interval: number): number {
  const n = interval > 0 ? Math.floor((duration * SPAWN_WINDOW) / interval) : 0;
  return Math.max(WAVES.PULSES_PER_WAVE_MIN, n);
}

/** Resets w.director for the plan. Boss waves spend no pulse budget (the boss is the threat). */
export function startWave(w: WorldState, plan: WavePlan): void {
  const d = w.director;
  d.budgetTotal = plan.budget;
  d.budgetLeft = plan.boss === null ? plan.budget : 0;
  d.pulseInterval = plan.pulseInterval;
  d.pulseTimer = FIRST_PULSE_DELAY;
  d.pulseIndex = 0;
  d.deferred = 0;
  d.bossSpawned = false;
  let mask = 0;
  for (let i = 0; i < plan.unlocked.length; i++) {
    const idx = ENEMY_KINDS.indexOf(plan.unlocked[i]!);
    if (idx >= 0) mask |= 1 << idx;
  }
  d.unlockedMask = mask;
  d.pending.clear();
}

/** True when the director has nothing left to spawn this wave (budget spent, no telegraphs pending). */
export function directorDone(w: WorldState): boolean {
  return w.director.budgetLeft <= 0 && w.director.pending.count === 0;
}

const WEIGHTS: number[] = [0, 0, 0, 0, 0, 0];
const PORTALS = new Int32Array(ARENA.PORTALS_PER_PULSE);
const POINT = { x: 0, z: 0 };

/** Weighted pick among unlocked kinds that fit in `share`; -1 when none fits. */
function pickKind(w: WorldState, share: number): number {
  const mask = w.director.unlockedMask;
  let any = false;
  for (let i = 0; i < ENEMY_KINDS.length; i++) {
    const kind = ENEMY_KINDS[i]!;
    const ok = (mask & (1 << i)) !== 0 && ENEMY_DEFS[kind].cost <= share;
    WEIGHTS[i] = ok ? (KIND_WEIGHTS[i] ?? 1) : 0;
    if (ok) any = true;
  }
  return any ? w.rng.sim.weightedPick(WEIGHTS) : -1;
}

/** Room under the 180 cap (live enemies + pending telegraphs) and the pending pool capacity. */
export function spawnRoom(w: WorldState): number {
  const pending = w.director.pending;
  const cap = WAVES.MAX_ALIVE - w.enemies.count - pending.count;
  const pendRoom = pending.capacity - pending.count;
  return cap < pendRoom ? cap : pendRoom;
}

/** Spends one pulse share as a formation at the farthest portals. Returns the number of enemies enqueued. */
export function runPulse(w: WorldState): number {
  const d = w.director;
  const total = pulseCount(w.run.waveDuration, d.pulseInterval);
  const remaining = total - d.pulseIndex > 1 ? total - d.pulseIndex : 1;
  let share = Math.ceil(d.budgetLeft / remaining);
  d.pulseIndex++;
  let room = spawnRoom(w);
  if (room <= 0 || share <= 0) return 0;
  const rng = w.rng.sim;
  const formation = WAVES.FORMATIONS[rng.int(0, WAVES.FORMATIONS.length - 1)]!;
  const portals = choosePortals(w, PORTALS);
  const chance = eliteChance(w.run.sector);
  let n = 0;
  while (share > 0 && room > 0) {
    const ki = pickKind(w, share);
    if (ki < 0) break;
    const kind = ENEMY_KINDS[ki]!;
    const portal = PORTALS[n % portals]!;
    formationPoint(formation, portal, Math.floor(n / portals), rng, POINT);
    const p = d.pending.spawn();
    if (p === null) break;
    p.kind = kind;
    p.x = POINT.x;
    p.z = POINT.z;
    p.delay = WAVES.TELEGRAPH;
    p.elite = chance > 0 && rng.chance(chance);
    p.portal = portal;
    const cost = ENEMY_DEFS[kind].cost;
    d.budgetLeft -= cost;
    share -= cost;
    room--;
    n++;
  }
  const used = n < portals ? n : portals;
  for (let i = 0; i < used; i++) {
    portalPosition(PORTALS[i]!, POINT);
    emitTelegraph(w, 0, POINT.x, POINT.z, 0, 1, PORTAL_TELEGRAPH_SIZE, WAVES.TELEGRAPH);
  }
  return n;
}

function stepWaveDirectorImpl(w: WorldState, _intents: Intents, dt: number): void {
  const d = w.director;
  const phase = w.run.phase;
  if (phase === 'boss' && !d.bossSpawned && w.mode !== 'versus') {
    d.bossSpawned = true;
    const id = bossForWave(w.run.wave);
    if (id !== null) spawnBoss(w, id);
  }
  if (phase !== 'combat' && phase !== 'boss') return;
  if (d.budgetLeft <= 0) return;
  d.pulseTimer -= dt;
  if (d.pulseTimer > 0) return;
  d.pulseTimer += d.pulseInterval > 0 ? d.pulseInterval : WAVES.PULSE_INTERVAL[0];
  runPulse(w);
}

/** pulses, formations, farthest 3 of 8 portals, telegraphs, 180 cap + deferral, boss spawn. */
export const stepWaveDirector: SimSystem = stepWaveDirectorImpl;
