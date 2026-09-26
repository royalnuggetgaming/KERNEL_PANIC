/**
 * Simulation world contracts (no three, no DOM). Positions are on the ground plane: x right, z toward camera.
 * Time is in seconds of SIM time (world.time = tick * SIM.DT). FROZEN after Wave 0.
 */
import type { BossId, EnemyKind, EntityHandle, PlayerIndex, SpecialKind, VehicleId } from './ids';
import type { DamageSource } from './simEvents';
import type { DerivedStats } from './upgrades';

// World aggregate types (WorldState, WorldView, RunCounters, SimSystem, ...) live in contracts/world.ts.

// ---------------------------------------------------------------- infrastructure ports (implemented in core/)

/** Seeded sfc32 generator (core/rng.ts). All sim randomness goes through world.rng.sim. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform uint32. */
  nextU32(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  chance(p: number): boolean;
  /** Throws on an empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Returns the chosen index; weights >= 0 with a positive sum. */
  weightedPick(weights: readonly number[]): number;
  shuffleInPlace<T>(arr: T[]): T[];
  /** Independent child stream derived from this stream's seed (not its position) plus label and salts. */
  fork(label: string, ...salts: number[]): Rng;
  /** Writes the 4-word state into out[0..3]. */
  getState(out: Uint32Array): void;
  setState(state: ArrayLike<number>): void;
}

/** Fields managed by EntityPool; systems never write them. */
export interface PooledRecord {
  /** Fixed storage slot in [0, capacity). */
  readonly slot: number;
  /** Generation, bumped on every spawn. */
  readonly gen: number;
  /** Index in the dense `active` array, -1 when free. */
  readonly di: number;
  /** Monotonic spawn sequence (oldest = smallest). */
  readonly seq: number;
}

/**
 * Preallocated pool with dense swap-remove `active` array (core/EntityPool.ts).
 * Iterate `for (let i = pool.count - 1; i >= 0; i--)` when despawning inside the loop.
 */
export interface EntityPoolApi<T extends PooledRecord> {
  readonly capacity: number;
  readonly count: number;
  /** Dense array, valid for indices [0, count). Length is `capacity`. */
  readonly active: readonly T[];
  /** Number of failed spawn() calls since creation/clear. */
  readonly exhausted: number;
  /** Returns a record with stale field values (caller initialises every field) or null when full. */
  spawn(): T | null;
  /** Like spawn() but when full despawns the OLDEST active record first (deterministic). */
  spawnRecycling(): T;
  despawn(rec: T): void;
  /** Record stored at a slot, alive or not. */
  atSlot(slot: number): T;
  isAlive(rec: T): boolean;
  handleOf(rec: T): EntityHandle;
  /** The live record for a handle, or null when stale/none. */
  resolve(h: EntityHandle): T | null;
  clear(): void;
}

export interface PoolView<T> {
  readonly active: readonly T[];
  readonly count: number;
}

/**
 * Uniform grid (16x16 cells of 4 u centred on the arena) rebuilt each tick by counting sort (core/SpatialGrid.ts).
 * Ids are caller-chosen integers (the sim stores ENEMY SLOTS so ids stay valid after swap-removes).
 */
export interface SpatialGridApi {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  begin(): void;
  add(id: number, x: number, z: number, radius: number): void;
  build(): void;
  /** Exact: ids whose circle (x, z, radius) intersects the query circle. Returns count written (<= out.length). */
  queryCircle(x: number, z: number, r: number, out: Int32Array): number;
  /** Broadphase: ids in every cell overlapping the AABB (unfiltered, each id once). */
  queryAabb(minX: number, minZ: number, maxX: number, maxZ: number, out: Int32Array): number;
}

// ---------------------------------------------------------------- entities

export interface Kinematic {
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  yaw: number;
  prevYaw: number;
  vx: number;
  vz: number;
}

/** respawning = Spare Kernel respawn delay (1.5 s). absent = not joined. */
export type LifeState = 'alive' | 'downed' | 'offline' | 'respawning' | 'absent';

export interface SpecialState {
  active: boolean;
  kind: SpecialKind;
  timer: number;
  duration: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  radius: number;
  tier: number;
  /** Patch Drone turret cadence accumulator. */
  fireAcc: number;
  /** SUDO: pending second cast count. */
  pendingCasts: number;
}

export const TRAIL_POINTS = 32;

export interface CardRuntime {
  missileTimer: number;
  nanoshieldTimer: number;
  nanoshieldReady: boolean;
  vampireKills: number;
  orbitAngle: number;
  overheatActive: boolean;
  forkShotCounter: number;
  /** Afterimage ring buffer: TRAIL_POINTS * 3 floats (x, z, birthTime). */
  trail: Float32Array;
  trailHead: number;
  trailCount: number;
  trailTimer: number;
}

export interface PlayerEntity extends Kinematic {
  readonly index: PlayerIndex;
  vehicle: VehicleId;
  life: LifeState;
  hp: number;
  radius: number;
  stats: DerivedStats;
  /** Stack counts indexed by CardDef.bit. */
  cardStacks: Uint8Array;
  /** Bit per owned card (1 << CardDef.bit). */
  cardMask: number;
  invulnUntil: number;
  hitFlash: number;
  dashTimer: number;
  dashCooldownLeft: number;
  dashCharges: number;
  dashDirX: number;
  dashDirZ: number;
  fireAcc: number;
  aimX: number;
  aimZ: number;
  overdrive: number;
  special: SpecialState;
  cards: CardRuntime;
  bleedLeft: number;
  downsThisWave: number;
  downedAt: number;
  reviveProgress: number;
  respawnTimer: number;
  contactCd: number;
  score: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  revives: number;
  combo: number;
  comboTimer: number;
  comboTier: number;
  bestCombo: number;
  lastKillTime: number;
}

export interface EnemyEntity extends PooledRecord, Kinematic {
  kind: EnemyKind;
  elite: boolean;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  /** Behaviour state index (enemyBehaviors.ts). */
  ai: number;
  aiTimer: number;
  dirX: number;
  dirZ: number;
  target: PlayerIndex;
  flash: number;
  /** Seconds since spawn (render dissolve-in). */
  age: number;
  seed: number;
  /** 1 while a Leech is latched onto the link beam. */
  latched: number;
  markedUntil: number;
  shotTimer: number;
  contactCd: number;
  /** Fork split generation (0 = original). */
  splitGen: number;
  /** Set by applyDamage on kill; resolveEnemyDeaths despawns. Collision skips dying enemies. */
  dying: boolean;
  lastHitBy: DamageSource;
}

export const PROJECTILE_KINDS = {
  bolt: 0,
  pellet: 1,
  needle: 2,
  arc: 3,
  missile: 4,
  mine: 5,
  turret: 6,
  enemyOrb: 7,
  enemySpike: 8,
  bossOrb: 9,
} as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[keyof typeof PROJECTILE_KINDS];

export interface ProjectileEntity extends PooledRecord {
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  /** Spawn position and time: linear bullets are extrapolated on the GPU from these. */
  originX: number;
  originZ: number;
  spawnTime: number;
  damage: number;
  radius: number;
  pierce: number;
  bounces: number;
  life: number;
  owner: DamageSource;
  kind: ProjectileKind;
  homing: EntityHandle;
  crit: boolean;
  /** Last enemy slot hit (pierce never hits the same target twice in a row), -1 none. */
  lastHit: number;
}

/** Filled by callers (module-scope scratch object) and passed to spawnProjectile. */
export interface ProjectileSpec {
  side: 'player' | 'enemy';
  owner: DamageSource;
  kind: ProjectileKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  damage: number;
  radius: number;
  life: number;
  pierce: number;
  bounces: number;
  crit: boolean;
  homing: EntityHandle;
}

export interface PickupEntity extends PooledRecord {
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  value: number;
  age: number;
  magnetTo: PlayerIndex | -1;
}

export interface BossEntity extends Kinematic {
  id: BossId;
  part: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  radius: number;
  phase: 0 | 1 | 2;
  patternStep: number;
  patternTimer: number;
  /** Shots emitted in the current step. */
  stepCount: number;
  aimAngle: number;
  enraged: boolean;
  introTimer: number;
  /** Sim time of death (Race Condition sync window), -1 alive. */
  deathTime: number;
  flash: number;
  splitGen: number;
  lastHitBy: DamageSource;
}

/** Boss sweep beams (shape 0) and Kernel firewall arc segments (shape 1). */
export interface LaserEntity extends PooledRecord {
  shape: 0 | 1;
  x: number;
  z: number;
  angle: number;
  angularVel: number;
  length: number;
  width: number;
  /** Arc segments: ring radius and half-angle (rad). */
  radius: number;
  arcHalf: number;
  /** Telegraph time left before it deals damage. */
  warmup: number;
  life: number;
  damage: number;
}

export interface LinkState {
  active: boolean;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  cut: boolean;
  length: number;
  /** Solo Echo Drone. */
  droneActive: boolean;
  droneX: number;
  droneZ: number;
  droneAngle: number;
  latchedCount: number;
}
