/**
 * Shared helpers for the content systems (enemies, bosses, patterns, wave director, rules): allocation-free
 * SimEvents producers, player targeting and the enemy-shot spec scratch. Every emitter writes every field.
 */
import { NO_HANDLE, type EnemyKind, type PlayerIndex, type BossId } from '../contracts/ids';
import {
  PROJECTILE_KINDS,
  type EnemyEntity,
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

/** Query point of nearestToProbe: [x, z] (scratch, so per-enemy retargeting passes no boxed doubles). */
const PROBE = new Float64Array(2);

function nearestToProbe(w: WorldView): PlayerIndex | -1 {
  const p0 = w.players[0];
  const p1 = w.players[1];
  const ok0 = isTargetable(p0);
  const ok1 = isTargetable(p1);
  if (!ok0 && !ok1) return -1;
  if (!ok1) return 0;
  if (!ok0) return 1;
  const x = PROBE[0]!;
  const z = PROBE[1]!;
  const d0 = (p0.x - x) * (p0.x - x) + (p0.z - z) * (p0.z - z);
  const d1 = (p1.x - x) * (p1.x - x) + (p1.z - z) * (p1.z - z);
  return d1 < d0 ? 1 : 0;
}

/** Nearest targetable player to (x, z), or -1 when nobody can be targeted. Ties go to P1. */
export function nearestTarget(w: WorldView, x: number, z: number): PlayerIndex | -1 {
  PROBE[0] = x;
  PROBE[1] = z;
  return nearestToProbe(w);
}

/** nearestTarget from enemy e's position. */
export function nearestTargetOf(w: WorldView, e: Readonly<EnemyEntity>): PlayerIndex | -1 {
  PROBE[0] = e.x;
  PROBE[1] = e.z;
  return nearestToProbe(w);
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
 * The next fireEnemyShotAt: [x, z, yaw, speed, damage, radius] (index constants below). Per-enemy callers
 * write it instead of passing doubles: a call that is not inlined boxes each double argument into a HeapNumber.
 */
export const ENEMY_MUZZLE = new Float64Array(6);
export const MUZZLE_X = 0;
export const MUZZLE_Z = 1;
export const MUZZLE_YAW = 2;
export const MUZZLE_SPEED = 3;
export const MUZZLE_DAMAGE = 4;
export const MUZZLE_RADIUS = 5;

/**
 * Fires one enemy-side projectile described by ENEMY_MUZZLE (yaw 0 = +Z, math.ts convention). Returns false
 * when the enemy-shot pool is full (deterministic skip).
 */
export function fireEnemyShotAt(w: WorldState, kind: ProjectileKind): boolean {
  const yaw = ENEMY_MUZZLE[MUZZLE_YAW]!;
  const speed = ENEMY_MUZZLE[MUZZLE_SPEED]!;
  SHOT.side = 'enemy';
  SHOT.owner = SOURCE_WORLD;
  SHOT.kind = kind;
  SHOT.x = ENEMY_MUZZLE[MUZZLE_X]!;
  SHOT.z = ENEMY_MUZZLE[MUZZLE_Z]!;
  SHOT.vx = Math.sin(yaw) * speed;
  SHOT.vz = Math.cos(yaw) * speed;
  SHOT.damage = ENEMY_MUZZLE[MUZZLE_DAMAGE]!;
  SHOT.radius = ENEMY_MUZZLE[MUZZLE_RADIUS]!;
  SHOT.life = ENEMY_SHOT_LIFE;
  SHOT.pierce = 0;
  SHOT.bounces = 0;
  SHOT.crit = false;
  SHOT.homing = NO_HANDLE;
  return spawnProjectile(w, SHOT) !== null;
}

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
  ENEMY_MUZZLE[MUZZLE_X] = x;
  ENEMY_MUZZLE[MUZZLE_Z] = z;
  ENEMY_MUZZLE[MUZZLE_YAW] = yaw;
  ENEMY_MUZZLE[MUZZLE_SPEED] = speed;
  ENEMY_MUZZLE[MUZZLE_DAMAGE] = damage;
  ENEMY_MUZZLE[MUZZLE_RADIUS] = radius;
  return fireEnemyShotAt(w, kind);
}

/** emitEnemyShot at the muzzle in ENEMY_MUZZLE. */
export function emitEnemyShotAtMuzzle(w: WorldState, boss: boolean): void {
  const e = w.events.enemyShot.push();
  e.x = ENEMY_MUZZLE[MUZZLE_X]!;
  e.z = ENEMY_MUZZLE[MUZZLE_Z]!;
  e.boss = boss;
}
