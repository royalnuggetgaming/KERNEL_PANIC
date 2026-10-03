/**
 * Entity record factories and per-run player (re)initialisation, shared by createWorld/resetWorld and
 * tests/helpers/worldFixture.ts. Wave 0 file.
 */
import { CARD_IDS, NO_HANDLE, type PlayerIndex, type RunMode } from '../contracts/ids';
import {
  PROJECTILE_KINDS,
  TRAIL_POINTS,
  type BossEntity,
  type CardRuntime,
  type EnemyEntity,
  type LaserEntity,
  type LinkState,
  type PickupEntity,
  type PlayerEntity,
  type ProjectileEntity,
  type SpecialState,
} from '../contracts/sim';
import { SOURCE_WORLD } from '../contracts/simEvents';
import type { DeathRecord, PendingSpawn, WorldPlayerInit } from '../contracts/world';
import { pooledBase } from '../core/EntityPool';
import { MOVEMENT } from '../config/tuning';
import { vehicleBaseStats } from '../config/vehicles';
import { VERSUS } from '../config/versus';

/** Players face up the screen (-Z) at spawn. */
export const SPAWN_YAW = Math.PI;

/** Spawn position for a player in a mode (versus mirrors the players on the x axis). */
export function spawnPosition(mode: RunMode, index: PlayerIndex, out: { x: number; z: number }): void {
  const side = index === 0 ? -1 : 1;
  out.z = 0;
  if (mode === 'solo') out.x = 0;
  else if (mode === 'versus') out.x = side * VERSUS.SPAWN_OFFSET;
  else out.x = side * 3;
}

export function createSpecialState(): SpecialState {
  return {
    active: false,
    kind: 'railburst',
    timer: 0,
    duration: 0,
    x: 0,
    z: 0,
    dirX: 0,
    dirZ: 0,
    radius: 0,
    tier: 0,
    fireAcc: 0,
    pendingCasts: 0,
    readyCued: false,
  };
}

export function createCardRuntime(): CardRuntime {
  return {
    missileTimer: 0,
    nanoshieldTimer: 0,
    nanoshieldReady: false,
    vampireKills: 0,
    orbitAngle: 0,
    overheatActive: false,
    forkShotCounter: 0,
    trail: new Float32Array(TRAIL_POINTS * 3),
    trailHead: 0,
    trailCount: 0,
    trailTimer: 0,
  };
}

export function createPlayer(index: PlayerIndex): PlayerEntity {
  return {
    index,
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    yaw: SPAWN_YAW,
    prevYaw: SPAWN_YAW,
    vx: 0,
    vz: 0,
    vehicle: 'lancer',
    life: 'absent',
    hp: 0,
    radius: MOVEMENT.PLAYER_RADIUS,
    stats: vehicleBaseStats('lancer'),
    cardStacks: new Uint8Array(CARD_IDS.length),
    cardMask: 0,
    invulnUntil: 0,
    hitFlash: 0,
    dashTimer: 0,
    dashCooldownLeft: 0,
    dashCharges: 0,
    dashDirX: 0,
    dashDirZ: 0,
    fireAcc: 0,
    aimX: 0,
    aimZ: -1,
    overdrive: 0,
    special: createSpecialState(),
    cards: createCardRuntime(),
    bleedLeft: 0,
    downsThisWave: 0,
    downedAt: -1,
    reviveProgress: 0,
    respawnTimer: 0,
    contactCd: 0,
    score: 0,
    kills: 0,
    damageDealt: 0,
    damageTaken: 0,
    revives: 0,
    combo: 0,
    comboTimer: 0,
    comboTier: 0,
    bestCombo: 0,
    lastKillTime: -1,
  };
}

const SPAWN_SCRATCH = { x: 0, z: 0 };

/** (Re)initialises a player slot for a new run. init = null marks the slot absent. */
export function initPlayer(p: PlayerEntity, init: WorldPlayerInit | null, mode: RunMode): void {
  const sp = createSpecialState();
  Object.assign(p.special, sp);
  const cr = p.cards;
  cr.missileTimer = 0;
  cr.nanoshieldTimer = 0;
  cr.nanoshieldReady = false;
  cr.vampireKills = 0;
  cr.orbitAngle = 0;
  cr.overheatActive = false;
  cr.forkShotCounter = 0;
  cr.trail.fill(0);
  cr.trailHead = 0;
  cr.trailCount = 0;
  cr.trailTimer = 0;
  p.cardStacks.fill(0);
  p.cardMask = 0;
  spawnPosition(mode, p.index, SPAWN_SCRATCH);
  p.x = p.prevX = SPAWN_SCRATCH.x;
  p.z = p.prevZ = SPAWN_SCRATCH.z;
  p.yaw = p.prevYaw = SPAWN_YAW;
  p.vx = p.vz = 0;
  p.vehicle = init?.vehicle ?? 'lancer';
  p.stats = init ? { ...init.stats } : vehicleBaseStats('lancer');
  p.life = init ? 'alive' : 'absent';
  p.hp = init ? p.stats.maxHp : 0;
  p.radius = MOVEMENT.PLAYER_RADIUS;
  p.invulnUntil = 0;
  p.hitFlash = 0;
  p.dashTimer = 0;
  p.dashCooldownLeft = 0;
  p.dashCharges = init ? p.stats.dashCharges : 0;
  p.dashDirX = 0;
  p.dashDirZ = 0;
  p.fireAcc = 0;
  p.aimX = 0;
  p.aimZ = -1;
  p.overdrive = init?.overdrive ?? 0;
  p.bleedLeft = 0;
  p.downsThisWave = 0;
  p.downedAt = -1;
  p.reviveProgress = 0;
  p.respawnTimer = 0;
  p.contactCd = 0;
  p.score = 0;
  p.kills = 0;
  p.damageDealt = 0;
  p.damageTaken = 0;
  p.revives = 0;
  p.combo = 0;
  p.comboTimer = 0;
  p.comboTier = 0;
  p.bestCombo = 0;
  p.lastKillTime = -1;
}

export function createEnemy(slot: number): EnemyEntity {
  return {
    ...pooledBase(slot),
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    yaw: 0,
    prevYaw: 0,
    vx: 0,
    vz: 0,
    kind: 'shard',
    elite: false,
    hp: 0,
    maxHp: 0,
    radius: 0,
    speed: 0,
    ai: 0,
    aiTimer: 0,
    dirX: 0,
    dirZ: 0,
    target: 0,
    flash: 0,
    age: 0,
    seed: 0,
    latched: 0,
    markedUntil: 0,
    shotTimer: 0,
    contactCd: 0,
    splitGen: 0,
    dying: false,
    lastHitBy: SOURCE_WORLD,
  };
}

export function createProjectile(slot: number): ProjectileEntity {
  return {
    ...pooledBase(slot),
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    vx: 0,
    vz: 0,
    originX: 0,
    originZ: 0,
    spawnTime: 0,
    damage: 0,
    radius: 0,
    pierce: 0,
    bounces: 0,
    life: 0,
    owner: SOURCE_WORLD,
    kind: PROJECTILE_KINDS.bolt,
    homing: NO_HANDLE,
    crit: false,
    lastHit: -1,
  };
}

export function createPickup(slot: number): PickupEntity {
  return {
    ...pooledBase(slot),
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    vx: 0,
    vz: 0,
    value: 0,
    age: 0,
    magnetTo: -1,
  };
}

export function createLaser(slot: number): LaserEntity {
  return {
    ...pooledBase(slot),
    shape: 0,
    x: 0,
    z: 0,
    angle: 0,
    angularVel: 0,
    length: 0,
    width: 0,
    radius: 0,
    arcHalf: 0,
    warmup: 0,
    life: 0,
    damage: 0,
  };
}

export function createPending(slot: number): PendingSpawn {
  return { ...pooledBase(slot), kind: 'shard', x: 0, z: 0, delay: 0, elite: false, portal: 0 };
}

export function createBoss(part: number): BossEntity {
  return {
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    yaw: 0,
    prevYaw: 0,
    vx: 0,
    vz: 0,
    id: 'forkBomb',
    part,
    alive: false,
    hp: 0,
    maxHp: 0,
    radius: 0,
    phase: 0,
    patternStep: 0,
    patternTimer: 0,
    stepCount: 0,
    aimAngle: 0,
    enraged: false,
    introTimer: 0,
    deathTime: -1,
    flash: 0,
    splitGen: 0,
    lastHitBy: SOURCE_WORLD,
  };
}

/** Resets a boss record in place (alive = false). */
export function clearBoss(b: BossEntity): void {
  Object.assign(b, createBoss(b.part));
}

export function createLink(): LinkState {
  return {
    active: false,
    ax: 0,
    az: 0,
    bx: 0,
    bz: 0,
    cut: false,
    length: 0,
    droneActive: false,
    droneX: 0,
    droneZ: 0,
    droneAngle: 0,
    latchedCount: 0,
  };
}

export function createDeathRecord(): DeathRecord {
  return {
    slot: 0,
    kind: 'shard',
    elite: false,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    by: SOURCE_WORLD,
    splitGen: 0,
    seed: 0,
  };
}
