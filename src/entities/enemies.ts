/**
 * Enemy lifecycle: spawnEnemy (wave HP scaling + CORRUPTED multiplier), stepEnemies (pending spawns,
 * staggered retarget, behaviours, separation over at most 6 grid neighbours, integration) and
 * resolveEnemyDeaths (despawn, Fork splits, Leech unlatch). Allocation-free per tick.
 */
import { ENEMY_KINDS, type EnemyKind } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type { EnemyEntity } from '../contracts/sim';
import { SOURCE_WORLD } from '../contracts/simEvents';
import type { SimSystem, WorldState } from '../contracts/world';
import { CORRUPTED, ENEMY_AI, ENEMY_DEFS } from '../config/enemies';
import { DEG2RAD } from '../core/math';
import { GRID_IN, gridQueryCircleIn } from '../core/SpatialGrid';
import { ARENA } from '../config/tuning';
import { AI_STATE, stepEnemyBehavior } from './enemyBehaviors';
import { clampToArena, emitSpawn, nearestTarget, nearestTargetOf } from './contentShared';

/** Hit flash decays to 0 over 1 / FLASH_DECAY seconds. */
const FLASH_DECAY = 8;
/** Fork children appear this far from the parent's centre. */
const SPLIT_OFFSET = 0.8;

const NEIGHBOURS = new Int32Array(32);
const CLAMP = { x: 0, z: 0 };

/** True while enemies act (spawning, moving, shooting). Purge/outro/countdown freeze them. */
export function enemiesActive(w: WorldState): boolean {
  const ph = w.run.phase;
  return ph === 'combat' || ph === 'boss';
}

function initialShotTimer(kind: EnemyKind, seed: number): number {
  const jitter = 0.4 + 0.6 * (((seed >>> 8) & 255) / 255);
  if (kind === 'spiker') return ENEMY_DEFS.spiker.params.interval * jitter;
  if (kind === 'warden') return ENEMY_DEFS.warden.params.volleyInterval * jitter;
  return 0;
}

/** Applies w.run.enemyHpMul (fixed at wave start) and the elite multiplier; returns null when the pool is full. */
export function spawnEnemy(
  w: WorldState,
  kind: EnemyKind,
  x: number,
  z: number,
  elite: boolean,
  splitGen: number,
): EnemyEntity | null {
  const e = w.enemies.spawn();
  if (e === null) return null;
  const d = ENEMY_DEFS[kind];
  const seed = w.rng.sim.nextU32();
  const hp = d.hp * w.run.enemyHpMul * (elite ? CORRUPTED.hpMul : 1);
  clampToArena(x, z, d.radius, CLAMP);
  e.x = e.prevX = CLAMP.x;
  e.z = e.prevZ = CLAMP.z;
  const yaw = Math.atan2(-CLAMP.x, -CLAMP.z);
  e.yaw = e.prevYaw = yaw;
  e.vx = 0;
  e.vz = 0;
  e.kind = kind;
  e.elite = elite;
  e.hp = hp;
  e.maxHp = hp;
  e.radius = d.radius;
  e.speed = d.speed;
  e.ai = AI_STATE.SEEK;
  e.aiTimer = 0;
  e.dirX = Math.sin(yaw);
  e.dirZ = Math.cos(yaw);
  const t = nearestTarget(w, e.x, e.z);
  e.target = t === -1 ? 0 : t;
  e.flash = 0;
  e.age = 0;
  e.seed = seed;
  e.latched = 0;
  e.markedUntil = 0;
  e.shotTimer = initialShotTimer(kind, seed);
  e.contactCd = 0;
  e.splitGen = splitGen;
  e.dying = false;
  e.lastHitBy = SOURCE_WORLD;
  return e;
}

/**
 * Advances telegraphed pending spawns (WaveDirector enqueues them). Expired entries become enemies; when the
 * enemy pool (the 180 cap) is full they wait and are counted in director.deferred.
 */
export function spawnPendingEnemies(w: WorldState, dt: number): void {
  const pending = w.director.pending;
  let blocked = 0;
  for (let i = pending.count - 1; i >= 0; i--) {
    const p = pending.active[i]!;
    p.delay -= dt;
    if (p.delay > 0) continue;
    p.delay = 0;
    const e = spawnEnemy(w, p.kind, p.x, p.z, p.elite, 0);
    if (e === null) {
      blocked++;
      continue;
    }
    emitSpawn(w, e.kind, e.x, e.z, e.elite);
    pending.despawn(p);
  }
  w.director.deferred = blocked;
}

function retarget(w: WorldState, e: EnemyEntity): void {
  const cur = w.players[e.target];
  if (cur.life === 'alive' && (w.tick + e.slot) % ENEMY_AI.RETARGET_STAGGER !== 0) return;
  const t = nearestTargetOf(w, e);
  if (t !== -1) e.target = t;
}

/**
 * Separation (<= 6 neighbours) then integration: moves e by its velocity, kept inside the arena disc minus its
 * radius (contentShared clampToArena's arithmetic). The grid query reads e's position from GRID_IN, so no double
 * is boxed whether or not V8 inlines the query.
 */
function separateAndMove(w: WorldState, e: EnemyEntity, dt: number): void {
  if (e.latched !== 1) {
    const r = ENEMY_AI.SEPARATION_RADIUS;
    GRID_IN[0] = e.x;
    GRID_IN[1] = e.z;
    GRID_IN[2] = r;
    const n = gridQueryCircleIn(w.grid, NEIGHBOURS);
    const cap = w.enemies.capacity;
    let used = 0;
    for (let i = 0; i < n && used < ENEMY_AI.SEPARATION_NEIGHBOURS; i++) {
      const id = NEIGHBOURS[i]!;
      if (id === e.slot || id < 0 || id >= cap) continue;
      const o = w.enemies.atSlot(id);
      if (!w.enemies.isAlive(o) || o.dying) continue;
      used++;
      const dx = e.x - o.x;
      const dz = e.z - o.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const reach = r + (e.radius + o.radius) * 0.5;
      if (d >= reach) continue;
      if (d < 1e-6) {
        // Exact overlap: split deterministically by slot order.
        e.vx += e.slot < o.slot ? ENEMY_AI.SEPARATION_FORCE : -ENEMY_AI.SEPARATION_FORCE;
        continue;
      }
      const f = ((reach - d) / reach) * ENEMY_AI.SEPARATION_FORCE;
      e.vx += (dx / d) * f;
      e.vz += (dz / d) * f;
    }
  }
  const x = e.x + e.vx * dt;
  const z = e.z + e.vz * dt;
  const lim = ARENA.RADIUS - e.radius;
  const d2 = x * x + z * z;
  if (d2 > lim * lim) {
    const k = lim / Math.sqrt(d2);
    e.x = x * k;
    e.z = z * k;
  } else {
    e.x = x;
    e.z = z;
  }
}

function stepEnemiesImpl(w: WorldState, _intents: Intents, dt: number): void {
  const active = enemiesActive(w);
  if (active) spawnPendingEnemies(w, dt);
  const pool = w.enemies;
  for (let i = pool.count - 1; i >= 0; i--) {
    const e = pool.active[i]!;
    if (e.dying) continue;
    e.prevX = e.x;
    e.prevZ = e.z;
    e.prevYaw = e.yaw;
    e.age += dt;
    e.flash = e.flash > 0 ? Math.max(0, e.flash - FLASH_DECAY * dt) : 0;
    if (!active) {
      e.vx = 0;
      e.vz = 0;
      continue;
    }
    retarget(w, e);
    stepEnemyBehavior(w, e, dt);
    separateAndMove(w, e, dt);
  }
}

/** behaviours, separation (<= 6 neighbours), staggered retarget (slot % 30), pending spawns. */
export const stepEnemies: SimSystem = stepEnemiesImpl;

function spawnForkChildren(w: WorldState, x: number, z: number, seed: number, splitGen: number): void {
  const p = ENEMY_DEFS.fork.params;
  const kind = ENEMY_KINDS[p.splitInto];
  const base = (seed % 360) * DEG2RAD;
  for (let i = 0; i < p.splitCount; i++) {
    const a = base + (i * Math.PI * 2) / p.splitCount;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const c = spawnEnemy(w, kind, x + dx * SPLIT_OFFSET, z + dz * SPLIT_OFFSET, false, splitGen + 1);
    if (c === null) return;
    c.vx = dx * p.splitSpeed;
    c.vz = dz * p.splitSpeed;
    c.yaw = c.prevYaw = a;
    c.dirX = dx;
    c.dirZ = dz;
    emitSpawn(w, c.kind, c.x, c.z, false);
  }
}

/** Drains and clears w.deathQueue: despawn dying enemies, Fork splits, Leech unlatch. */
export function resolveEnemyDeaths(w: WorldState): void {
  const q = w.deathQueue;
  const pool = w.enemies;
  for (let i = 0; i < q.count; i++) {
    const rec = q.get(i);
    const e = pool.atSlot(rec.slot);
    if (pool.isAlive(e) && e.dying) {
      if (e.latched === 1) {
        e.latched = 0;
        if (w.link.latchedCount > 0) w.link.latchedCount--;
      }
      pool.despawn(e);
    }
    if (rec.kind === 'fork' && rec.splitGen === 0) {
      spawnForkChildren(w, rec.x, rec.z, rec.seed, rec.splitGen);
    }
  }
  q.clear();
}

/** Removes every enemy immediately (round resets, debug). Latched counts are reset with the pool. */
export function clearEnemies(w: WorldState): void {
  w.enemies.clear();
  w.director.pending.clear();
  w.link.latchedCount = 0;
}
