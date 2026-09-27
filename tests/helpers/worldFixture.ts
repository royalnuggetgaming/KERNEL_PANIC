/**
 * Test worlds built through the real sim/createWorld plus direct pool helpers, so Wave 1 agents can test
 * their systems before spawnEnemy/spawnProjectile/spawnPickup exist.
 */
import type { EnemyKind, PlayerIndex, RunMode, VehicleId } from '../../src/contracts/ids';
import { NO_HANDLE } from '../../src/contracts/ids';
import type { Intents } from '../../src/contracts/input';
import type { EnemyEntity, PickupEntity, ProjectileEntity, ProjectileKind } from '../../src/contracts/sim';
import { PROJECTILE_KINDS } from '../../src/contracts/sim';
import { SOURCE_WORLD, type DamageSource } from '../../src/contracts/simEvents';
import type { SimSystem, WorldConfig, WorldState } from '../../src/contracts/world';
import { ENEMY_DEFS } from '../../src/config/enemies';
import { SIM } from '../../src/config/tuning';
import { vehicleBaseStats } from '../../src/config/vehicles';
import { createWorld } from '../../src/sim/createWorld';
import { createIntents } from './scriptedIntents';

export interface TestWorldOptions {
  readonly seed?: number;
  readonly mode?: RunMode;
  readonly vehicles?: readonly [VehicleId, VehicleId];
  readonly startShards?: number;
  readonly startKernels?: number;
}

export function testWorldConfig(o: TestWorldOptions = {}): WorldConfig {
  const mode = o.mode ?? 'coop';
  const v = o.vehicles ?? ['lancer', 'bulwark'];
  return {
    seed: o.seed ?? 1,
    mode,
    players: [
      { vehicle: v[0], stats: vehicleBaseStats(v[0]), overdrive: 0 },
      mode === 'solo' ? null : { vehicle: v[1], stats: vehicleBaseStats(v[1]), overdrive: 0 },
    ],
    startShards: o.startShards ?? 0,
    startKernels: o.startKernels ?? 1,
  };
}

/** createWorld(testWorldConfig(o)). Default: co-op, seed 1, Lancer + Bulwark. */
export function createTestWorld(o: TestWorldOptions = {}): WorldState {
  return createWorld(testWorldConfig(o));
}

/** Spawns an enemy straight into the pool with def stats (no wave scaling). Throws when the pool is full. */
export function addTestEnemy(
  w: WorldState,
  kind: EnemyKind,
  x: number,
  z: number,
  patch: Partial<Omit<EnemyEntity, 'slot' | 'gen' | 'di' | 'seq'>> = {},
): EnemyEntity {
  const e = w.enemies.spawn();
  if (e === null) throw new Error('addTestEnemy: enemy pool full');
  const d = ENEMY_DEFS[kind];
  Object.assign(e, {
    x,
    z,
    prevX: x,
    prevZ: z,
    yaw: 0,
    prevYaw: 0,
    vx: 0,
    vz: 0,
    kind,
    elite: false,
    hp: d.hp,
    maxHp: d.hp,
    radius: d.radius,
    speed: d.speed,
    ai: 0,
    aiTimer: 0,
    dirX: 0,
    dirZ: 1,
    target: 0,
    flash: 0,
    age: 1,
    seed: e.slot,
    latched: 0,
    markedUntil: 0,
    shotTimer: 0,
    contactCd: 0,
    splitGen: 0,
    dying: false,
    lastHitBy: SOURCE_WORLD,
  });
  Object.assign(e, patch);
  return e;
}

function initShot(
  p: ProjectileEntity,
  w: WorldState,
  owner: DamageSource,
  kind: ProjectileKind,
  x: number,
  z: number,
  vx: number,
  vz: number,
  damage: number,
): ProjectileEntity {
  Object.assign(p, {
    x,
    z,
    prevX: x,
    prevZ: z,
    vx,
    vz,
    originX: x,
    originZ: z,
    spawnTime: w.time,
    damage,
    radius: 0.25,
    pierce: 0,
    bounces: 0,
    life: 1,
    owner,
    kind,
    homing: NO_HANDLE,
    crit: false,
    lastHit: -1,
  });
  return p;
}

export function addTestPlayerShot(
  w: WorldState,
  owner: PlayerIndex,
  x: number,
  z: number,
  vx: number,
  vz: number,
  damage = 10,
  patch: Partial<Omit<ProjectileEntity, 'slot' | 'gen' | 'di' | 'seq'>> = {},
): ProjectileEntity {
  const p = initShot(w.playerShots.spawnRecycling(), w, owner, PROJECTILE_KINDS.bolt, x, z, vx, vz, damage);
  return Object.assign(p, patch);
}

export function addTestEnemyShot(
  w: WorldState,
  x: number,
  z: number,
  vx: number,
  vz: number,
  damage = 10,
  patch: Partial<Omit<ProjectileEntity, 'slot' | 'gen' | 'di' | 'seq'>> = {},
): ProjectileEntity {
  const s = w.enemyShots.spawn();
  if (s === null) throw new Error('addTestEnemyShot: pool full');
  const p = initShot(s, w, SOURCE_WORLD, PROJECTILE_KINDS.enemyOrb, x, z, vx, vz, damage);
  return Object.assign(p, patch);
}

export function addTestPickup(w: WorldState, x: number, z: number, value = 1): PickupEntity {
  const p = w.pickups.spawn();
  if (p === null) throw new Error('addTestPickup: pool full');
  Object.assign(p, { x, z, prevX: x, prevZ: z, vx: 0, vz: 0, value, age: 0, magnetTo: -1 });
  return p;
}

/** Places a player (and its prev position) without stepping. */
export function placePlayer(w: WorldState, index: PlayerIndex, x: number, z: number): void {
  const p = w.players[index];
  p.x = p.prevX = x;
  p.z = p.prevZ = z;
}

/**
 * Runs `system` for n ticks with fixed SIM.DT, advancing world.tick/time like stepWorld does.
 * intents default to idle.
 */
export function stepSystem(
  w: WorldState,
  system: SimSystem,
  n: number,
  intents: Intents = createIntents(),
): void {
  for (let i = 0; i < n; i++) {
    system(w, intents, SIM.DT);
    w.tick++;
    w.time = w.tick * SIM.DT;
  }
}

/** Counts events currently in a channel-like object. */
export function eventCount(ch: { readonly count: number }): number {
  return ch.count;
}
