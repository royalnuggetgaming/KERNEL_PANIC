/**
 * Debug-only world manipulation for the dev API (stress load, wave control, god mode). Runs between sim ticks
 * on the live RunSession world; uses a Math.random stream, so a stressed run is not deterministic.
 */
import type { PlayerIndex } from '../contracts/ids';
import { ENEMY_KINDS } from '../contracts/ids';
import { PROJECTILE_KINDS, type ProjectileSpec } from '../contracts/sim';
import { SOURCE_WORLD } from '../contracts/simEvents';
import type { WorldState } from '../contracts/world';
import { CAPACITY } from '../config/tuning';
import { emitExplosionEvent } from '../entities/contentShared';
import { spawnEnemy } from '../entities/enemies';
import { spawnProjectile } from '../entities/projectiles';
import { grantShards } from '../entities/wallet';
import { beginWave } from '../sim/rules';
import { beginVersusRound } from '../sim/versusRules';

export interface StressTargets {
  enemies: number;
  shots: number;
  particles: number;
}

/** Average particles per explosion burst at power 1 (FxDirector BLAST: 12 + 26). */
const PARTICLES_PER_BLAST = 38;
/** Average particle lifetime in seconds (burst specs live 0.5-0.8 s). */
const PARTICLE_LIFE_S = 0.7;
const SHOT_LIFE_S = 1.6;
const MAX_BLASTS_PER_FRAME = 64;

const SHOT: ProjectileSpec = {
  side: 'player',
  owner: 0,
  kind: PROJECTILE_KINDS.bolt,
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  damage: 0.05,
  radius: 0.2,
  life: SHOT_LIFE_S,
  pierce: 99,
  bounces: 0,
  crit: false,
  homing: -1,
};

function randomRing(rMin: number, rMax: number, out: { x: number; z: number }): void {
  const a = Math.random() * Math.PI * 2;
  const r = rMin + Math.random() * (rMax - rMin);
  out.x = Math.sin(a) * r;
  out.z = Math.cos(a) * r;
}

const POINT = { x: 0, z: 0 };

function topUpShots(w: WorldState, want: number): void {
  const playerWant = Math.min(CAPACITY.playerShots, Math.round(want * 0.75));
  const enemyWant = Math.min(CAPACITY.enemyShots, want - playerWant);
  let guard = CAPACITY.playerShots + CAPACITY.enemyShots;
  while (guard-- > 0 && (w.playerShots.count < playerWant || w.enemyShots.count < enemyWant)) {
    const player = w.playerShots.count < playerWant;
    randomRing(2, 26, POINT);
    const a = Math.random() * Math.PI * 2;
    const speed = player ? 38 : 14;
    SHOT.side = player ? 'player' : 'enemy';
    SHOT.owner = player ? (Math.random() < 0.5 ? 0 : 1) : SOURCE_WORLD;
    SHOT.kind = player ? PROJECTILE_KINDS.bolt : PROJECTILE_KINDS.enemyOrb;
    SHOT.damage = player ? 0.05 : 1;
    SHOT.x = POINT.x;
    SHOT.z = POINT.z;
    SHOT.vx = Math.sin(a) * speed;
    SHOT.vz = Math.cos(a) * speed;
    SHOT.life = SHOT_LIFE_S * (0.5 + Math.random());
    if (spawnProjectile(w, SHOT) === null) break;
  }
}

function topUpEnemies(w: WorldState, want: number): void {
  const target = Math.min(CAPACITY.enemies, want);
  let guard = CAPACITY.enemies;
  while (w.enemies.count < target && guard-- > 0) {
    randomRing(10, 28, POINT);
    const kind = ENEMY_KINDS[Math.floor(Math.random() * ENEMY_KINDS.length)]!;
    if (spawnEnemy(w, kind, POINT.x, POINT.z, Math.random() < 0.1, 0) === null) break;
  }
}

/** One frame of sustained stress load (call once per rendered frame while Playing). */
export function applyStress(w: WorldState, t: StressTargets, frameDt: number): void {
  if (w.run.phase === 'countdown') w.run.phaseTimer = Math.min(w.run.phaseTimer, 0.05);
  // Keep the wave alive so the load is not interrupted by a purge or a clear.
  if (w.run.waveTimer < 30) w.run.waveTimer = 30;
  if (t.enemies > 0) topUpEnemies(w, t.enemies);
  if (t.shots > 0) topUpShots(w, t.shots);
  if (t.particles > 0) {
    const perSecond = t.particles / PARTICLE_LIFE_S / PARTICLES_PER_BLAST;
    const blasts = Math.min(MAX_BLASTS_PER_FRAME, Math.ceil(perSecond * Math.max(frameDt, 1 / 120)));
    for (let i = 0; i < blasts; i++) {
      randomRing(0, 28, POINT);
      emitExplosionEvent(w, POINT.x, POINT.z, 1.5, 1);
    }
  }
}

/** Keeps every joined player invulnerable and at full HP for the next second of sim time. */
export function applyGodMode(w: WorldState): void {
  for (let i = 0; i < 2; i++) {
    const p = w.players[i === 0 ? 0 : 1];
    if (p.life === 'absent') continue;
    if (p.invulnUntil < w.time + 1) p.invulnUntil = w.time + 1;
    if (p.life === 'alive' && p.hp < p.stats.maxHp) p.hp = p.stats.maxHp;
  }
}

export function setWorldWave(w: WorldState, wave: number): boolean {
  const n = Math.max(1, Math.floor(wave));
  if (w.mode === 'versus') beginVersusRound(w, n);
  else beginWave(w, n);
  return true;
}

/**
 * Ends the current wave quickly: co-op/solo jumps to the timer expiry (PURGE, then the clear outro);
 * versus drops P2 to a quarter HP and expires the round timer so P1 wins on HP.
 */
export function clearWorldWave(w: WorldState): boolean {
  const run = w.run;
  if (run.phase === 'countdown') run.phaseTimer = Math.min(run.phaseTimer, 0.02);
  if (w.mode === 'versus') {
    const p2 = w.players[1];
    if (p2.life === 'alive') p2.hp = Math.max(1, Math.floor(p2.stats.maxHp * 0.25));
    const p1 = w.players[0];
    if (p1.life === 'alive') p1.hp = p1.stats.maxHp;
  } else {
    w.director.budgetLeft = 0;
    w.director.pending.clear();
  }
  run.waveTimer = Math.min(run.waveTimer, 0.05);
  return true;
}

export function giveWorldShards(w: WorldState, p: PlayerIndex, n: number): boolean {
  return grantShards(w, p, n) > 0;
}
