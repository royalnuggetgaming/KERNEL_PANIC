/**
 * Projectile spawning and integration: linear and homing motion, lifetime, circular-arena wall bounce and
 * the pool exhaustion policy (player shots recycle the oldest, enemy shots skip spawning).
 */
import { NO_HANDLE, type EntityHandle, type PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import {
  PROJECTILE_KINDS,
  type EntityPoolApi,
  type ProjectileEntity,
  type ProjectileSpec,
} from '../contracts/sim';
import type { SimSystem, WorldState } from '../contracts/world';
import { CARD_PARAMS } from '../config/cards';
import { SPECIALS } from '../config/specials';
import { ARENA } from '../config/tuning';

/** Homing handles <= this encode a player target (versus seeker mines): handle = BASE - playerIndex. */
export const PLAYER_HOMING_BASE = -10;
/** Seeker mines acquire targets inside this radius. */
export const MINE_SEEK_RANGE = SPECIALS.blinkSwarm.mineTriggerRadius * 3;
const TURRET_TURN_RATE = 8;

export function playerHomingHandle(p: PlayerIndex): EntityHandle {
  return PLAYER_HOMING_BASE - p;
}

/** Player side recycles the oldest shot when full (never null); enemy side returns null when full. */
export function spawnProjectile(w: WorldState, spec: Readonly<ProjectileSpec>): ProjectileEntity | null {
  let s: ProjectileEntity | null;
  if (spec.side === 'player') s = w.playerShots.spawnRecycling();
  else s = w.enemyShots.spawn();
  if (s === null) return null;
  s.x = spec.x;
  s.z = spec.z;
  s.prevX = spec.x;
  s.prevZ = spec.z;
  s.vx = spec.vx;
  s.vz = spec.vz;
  s.originX = spec.x;
  s.originZ = spec.z;
  s.spawnTime = w.time;
  s.damage = spec.damage;
  s.radius = spec.radius;
  s.pierce = spec.pierce;
  s.bounces = spec.bounces;
  s.life = spec.life;
  s.owner = spec.owner;
  s.kind = spec.kind;
  s.homing = spec.homing;
  s.crit = spec.crit;
  s.lastHit = -1;
  return s;
}

/** Homing handles <= this encode a boss part: handle = BASE - index into w.bosses. */
export const BOSS_HOMING_BASE = -20;

export function bossHomingHandle(k: number): EntityHandle {
  return BOSS_HOMING_BASE - k;
}

/** Result of the last nearestTarget call (reused, allocation-free). */
export const NEAREST = { x: 0, z: 0, handle: NO_HANDLE as EntityHandle };

/**
 * Nearest hittable target within `range` of (x, z): live non-dying enemies and living boss parts past their
 * intro. Fills NEAREST (x, z, homing handle) and returns the handle, or NO_HANDLE when none is in range.
 */
export function nearestTarget(w: WorldState, x: number, z: number, range: number): EntityHandle {
  let bestD = range * range;
  NEAREST.handle = NO_HANDLE;
  const pool = w.enemies;
  for (let i = 0; i < pool.count; i++) {
    const e = pool.active[i]!;
    if (e.dying) continue;
    const dx = e.x - x;
    const dz = e.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      NEAREST.x = e.x;
      NEAREST.z = e.z;
      NEAREST.handle = pool.handleOf(e);
    }
  }
  for (let k = 0; k < w.bosses.length; k++) {
    const b = w.bosses[k]!;
    if (!b.alive || b.introTimer > 0) continue;
    const dx = b.x - x;
    const dz = b.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      NEAREST.x = b.x;
      NEAREST.z = b.z;
      NEAREST.handle = bossHomingHandle(k);
    }
  }
  return NEAREST.handle;
}

/** Restarts GPU extrapolation after a velocity change. */
function rebase(w: WorldState, s: ProjectileEntity): void {
  s.originX = s.x;
  s.originZ = s.z;
  s.spawnTime = w.time;
}

const TARGET = { x: 0, z: 0, ok: false };

/** Resolves a homing handle into TARGET (enemy slot handle or encoded player). */
function resolveTarget(w: WorldState, h: EntityHandle): void {
  TARGET.ok = false;
  if (h === NO_HANDLE) return;
  if (h <= BOSS_HOMING_BASE) {
    const b = w.bosses[BOSS_HOMING_BASE - h];
    if (!b?.alive) return;
    TARGET.x = b.x;
    TARGET.z = b.z;
    TARGET.ok = true;
    return;
  }
  if (h <= PLAYER_HOMING_BASE) {
    const idx = PLAYER_HOMING_BASE - h;
    if (idx !== 0 && idx !== 1) return;
    const p = w.players[idx];
    if (p.life !== 'alive') return;
    TARGET.x = p.x;
    TARGET.z = p.z;
    TARGET.ok = true;
    return;
  }
  const e = w.enemies.resolve(h);
  if (e === null || e.dying) return;
  TARGET.x = e.x;
  TARGET.z = e.z;
  TARGET.ok = true;
}

function acquireMineTarget(w: WorldState, s: ProjectileEntity): void {
  let bestD = MINE_SEEK_RANGE * MINE_SEEK_RANGE;
  s.homing = nearestTarget(w, s.x, s.z, MINE_SEEK_RANGE);
  if (s.homing !== NO_HANDLE) {
    const dx = NEAREST.x - s.x;
    const dz = NEAREST.z - s.z;
    bestD = dx * dx + dz * dz;
  }
  if (w.mode === 'versus' && (s.owner === 0 || s.owner === 1)) {
    const q = w.players[s.owner === 0 ? 1 : 0];
    if (q.life === 'alive') {
      const dx = q.x - s.x;
      const dz = q.z - s.z;
      if (dx * dx + dz * dz < bestD) s.homing = playerHomingHandle(q.index);
    }
  }
}

function steer(w: WorldState, s: ProjectileEntity, dt: number): void {
  if (s.kind === PROJECTILE_KINDS.mine) {
    resolveTarget(w, s.homing);
    if (!TARGET.ok) {
      acquireMineTarget(w, s);
      resolveTarget(w, s.homing);
    }
    if (!TARGET.ok) {
      if (s.vx !== 0 || s.vz !== 0) {
        s.vx = 0;
        s.vz = 0;
        rebase(w, s);
      }
      return;
    }
    const dx = TARGET.x - s.x;
    const dz = TARGET.z - s.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-6) return;
    const sp = SPECIALS.blinkSwarm.mineSeekSpeed;
    s.vx = (dx / l) * sp;
    s.vz = (dz / l) * sp;
    rebase(w, s);
    return;
  }
  if (s.homing === NO_HANDLE) return;
  resolveTarget(w, s.homing);
  if (!TARGET.ok && s.kind === PROJECTILE_KINDS.missile) {
    s.homing = nearestTarget(w, s.x, s.z, ARENA.RADIUS * 2);
    resolveTarget(w, s.homing);
  }
  if (!TARGET.ok) return;
  const turn = s.kind === PROJECTILE_KINDS.missile ? CARD_PARAMS.microMissiles.turnRate : TURRET_TURN_RATE;
  const speed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (speed < 1e-6) return;
  const cur = Math.atan2(s.vx, s.vz);
  const want = Math.atan2(TARGET.x - s.x, TARGET.z - s.z);
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const maxStep = turn * dt;
  const a = cur + (d > maxStep ? maxStep : d < -maxStep ? -maxStep : d);
  s.vx = Math.sin(a) * speed;
  s.vz = Math.cos(a) * speed;
  rebase(w, s);
}

/** Wall handling; returns false when the projectile must despawn. */
function wall(w: WorldState, s: ProjectileEntity): boolean {
  const r2 = s.x * s.x + s.z * s.z;
  const lim = ARENA.RADIUS;
  if (r2 <= lim * lim) return true;
  if (s.bounces <= 0) return false;
  const r = Math.sqrt(r2);
  const nx = s.x / r;
  const nz = s.z / r;
  const dot = s.vx * nx + s.vz * nz;
  if (dot > 0) {
    s.vx -= 2 * dot * nx;
    s.vz -= 2 * dot * nz;
  }
  s.x = nx * (lim - 0.01);
  s.z = nz * (lim - 0.01);
  s.bounces--;
  rebase(w, s);
  return true;
}

function stepPool(w: WorldState, pool: EntityPoolApi<ProjectileEntity>, player: boolean, dt: number): void {
  for (let i = pool.count - 1; i >= 0; i--) {
    const s = pool.active[i]!;
    s.prevX = s.x;
    s.prevZ = s.z;
    s.life -= dt;
    if (s.life <= 0) {
      pool.despawn(s);
      continue;
    }
    if (player) steer(w, s, dt);
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    if (!wall(w, s)) pool.despawn(s);
  }
}

export const stepProjectiles: SimSystem = (w: WorldState, _intents: Intents, dt: number): void => {
  stepPool(w, w.playerShots, true, dt);
  stepPool(w, w.enemyShots, false, dt);
};
