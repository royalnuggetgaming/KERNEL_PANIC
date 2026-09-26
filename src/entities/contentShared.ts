/**
 * Shared helpers for the content systems (enemies, bosses, patterns, wave director, rules): allocation-free
 * SimEvents producers, player targeting and the enemy-shot spec scratch. Every emitter writes every field.
 */
import { NO_HANDLE, type EnemyKind, type PlayerIndex, type BossId } from '../contracts/ids';
import {
  PROJECTILE_KINDS,
  type PlayerEntity,
  type ProjectileKind,
  type ProjectileSpec,
} from '../contracts/sim';
import { SOURCE_WORLD, type WaveEventKind } from '../contracts/simEvents';
import type { WorldState, WorldView } from '../contracts/world';
import { ARENA } from '../config/tuning';
import { spawnProjectile } from './projectiles';

/** Enemies and bosses target only craft that are alive (downed, offline and respawning are ignored). */
export function isTargetable(p: Readonly<PlayerEntity>): boolean {
  return p.life === 'alive';
}

/** Nearest targetable player to (x, z), or -1 when nobody can be targeted. Ties go to P1. */
export function nearestTarget(w: WorldView, x: number, z: number): PlayerIndex | -1 {
  const p0 = w.players[0];
  const p1 = w.players[1];
  const ok0 = isTargetable(p0);
  const ok1 = isTargetable(p1);
  if (!ok0 && !ok1) return -1;
  if (!ok1) return 0;
  if (!ok0) return 1;
  const d0 = (p0.x - x) * (p0.x - x) + (p0.z - z) * (p0.z - z);
  const d1 = (p1.x - x) * (p1.x - x) + (p1.z - z) * (p1.z - z);
  return d1 < d0 ? 1 : 0;
}

/** Keeps (x, z) inside the arena disc minus `inset`; writes into out. */
export function clampToArena(x: number, z: number, inset: number, out: { x: number; z: number }): void {
  const r = ARENA.RADIUS - inset;
  const d2 = x * x + z * z;
  if (d2 > r * r) {
    const s = r / Math.sqrt(d2);
    out.x = x * s;
    out.z = z * s;
  } else {
    out.x = x;
    out.z = z;
  }
}

export function emitWaveEvent(
  w: WorldState,
  what: WaveEventKind,
  value: number,
  player: PlayerIndex | -1,
): void {
  const e = w.events.wave.push();
  e.what = what;
  e.wave = w.mode === 'versus' ? w.run.round : w.run.wave;
  e.value = value;
  e.player = player;
}

export function emitTelegraph(
  w: WorldState,
  shape: 0 | 1,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  size: number,
  duration: number,
): void {
  const e = w.events.telegraph.push();
  e.shape = shape;
  e.x = x;
  e.z = z;
  e.dirX = dirX;
  e.dirZ = dirZ;
  e.size = size;
  e.duration = duration;
}

export function emitSpawn(w: WorldState, kind: EnemyKind, x: number, z: number, elite: boolean): void {
  const e = w.events.spawn.push();
  e.kind = kind;
  e.x = x;
  e.z = z;
  e.elite = elite;
}

export function emitEnemyShot(w: WorldState, x: number, z: number, boss: boolean): void {
  const e = w.events.enemyShot.push();
  e.x = x;
  e.z = z;
  e.boss = boss;
}

export function emitExplosionEvent(w: WorldState, x: number, z: number, radius: number, power: number): void {
  const e = w.events.explosion.push();
  e.x = x;
  e.z = z;
  e.radius = radius;
  e.power = power;
}

export function emitBossEvent(
  w: WorldState,
  id: BossId,
  part: number,
  what: 'intro' | 'phase' | 'enrage' | 'split' | 'respawn' | 'dead',
  x: number,
  z: number,
): void {
  const e = w.events.boss.push();
  e.id = id;
  e.part = part;
  e.what = what;
  e.x = x;
  e.z = z;
}

const SHOT: ProjectileSpec = {
  side: 'enemy',
  owner: SOURCE_WORLD,
  kind: PROJECTILE_KINDS.enemyOrb,
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  damage: 0,
  radius: 0,
  life: 0,
  pierce: 0,
  bounces: 0,
  crit: false,
  homing: NO_HANDLE,
};

/** Enemy bullet radius and lifetime (long enough to cross the arena at the slowest enemy shot speed). */
export const ENEMY_SHOT_RADIUS = 0.3;
export const BOSS_SHOT_RADIUS = 0.38;
export const ENEMY_SHOT_LIFE = 6;

/**
 * Fires one enemy-side projectile along angle `yaw` (0 = +Z, math.ts convention). Returns false when the
 * enemy-shot pool is full (deterministic skip).
 */
export function fireEnemyShot(
  w: WorldState,
  kind: ProjectileKind,
  x: number,
  z: number,
  yaw: number,
  speed: number,
  damage: number,
  radius: number,
): boolean {
  SHOT.side = 'enemy';
  SHOT.owner = SOURCE_WORLD;
  SHOT.kind = kind;
  SHOT.x = x;
  SHOT.z = z;
  SHOT.vx = Math.sin(yaw) * speed;
  SHOT.vz = Math.cos(yaw) * speed;
  SHOT.damage = damage;
  SHOT.radius = radius;
  SHOT.life = ENEMY_SHOT_LIFE;
  SHOT.pierce = 0;
  SHOT.bounces = 0;
  SHOT.crit = false;
  SHOT.homing = NO_HANDLE;
  return spawnProjectile(w, SHOT) !== null;
}
