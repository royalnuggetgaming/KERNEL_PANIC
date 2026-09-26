/**
 * Per-kind enemy behaviour state machines (plan section 8 "enemyBehaviors.ts"):
 * seek (Shard, Fork), telegraph-lunge (Dart), ring-burst (Spiker), shielded advance + volley (Warden),
 * beam latch (Leech). Behaviours only write intent (velocity, facing, ai state) and fire enemy shots;
 * stepEnemies integrates positions and applies separation. Allocation-free.
 */
import { PROJECTILE_KINDS, type EnemyEntity } from '../contracts/sim';
import type { WorldState } from '../contracts/world';
import { ENEMY_DEFS } from '../config/enemies';
import { DEG2RAD, TAU, inArc, turnToward } from '../core/math';
import {
  ENEMY_SHOT_RADIUS,
  emitEnemyShot,
  emitTelegraph,
  fireEnemyShot,
  isTargetable,
} from './contentShared';

/** Behaviour state indices stored in EnemyEntity.ai. */
export const AI_STATE = {
  SEEK: 0,
  TELEGRAPH: 1,
  LUNGE: 2,
  RECOVER: 3,
  HOLD: 4,
  CHARGE: 5,
  LATCHED: 6,
} as const;

/** Turn rate (rad/s) for kinds whose def has no turnRate param. */
const DEFAULT_TURN = 5;
/** Enemies with nobody to chase drift toward the arena centre at this fraction of their speed. */
const IDLE_SPEED_MUL = 0.3;
const DART_RECOVER_SPEED_MUL = 0.25;
const SPIKER_ORBIT_MUL = 0.5;
/** Spikers fire only when their target is within keepRange + this. */
const SPIKER_FIRE_SLACK = 8;
const SPIKER_TELEGRAPH_SIZE = 2.5;
const WARDEN_STOP_DIST = 3;
const WARDEN_FIRE_RANGE = 22;
const LEECH_KNOCKOFF = 0.6;
const LEECH_SNAP_MUL = 3;
const LEECH_T_MIN = 0.05;
const LEECH_T_MAX = 0.95;

const SHARD = ENEMY_DEFS.shard;
const DART = ENEMY_DEFS.dart;
const SPIKER = ENEMY_DEFS.spiker;
const WARDEN = ENEMY_DEFS.warden;

/** Turns e toward (tx, tz) at `rate` rad/s and moves along its facing at `speed`. */
function steer(e: EnemyEntity, tx: number, tz: number, rate: number, speed: number, dt: number): void {
  const dx = tx - e.x;
  const dz = tz - e.z;
  if (dx * dx + dz * dz > 1e-8) {
    e.yaw = turnToward(e.yaw, Math.atan2(dx, dz), rate * dt);
  }
  e.dirX = Math.sin(e.yaw);
  e.dirZ = Math.cos(e.yaw);
  e.vx = e.dirX * speed;
  e.vz = e.dirZ * speed;
}

function stop(e: EnemyEntity): void {
  e.vx = 0;
  e.vz = 0;
}

function idle(e: EnemyEntity, dt: number): void {
  e.ai = AI_STATE.SEEK;
  if (e.x * e.x + e.z * e.z < 4) {
    stop(e);
    return;
  }
  steer(e, 0, 0, DEFAULT_TURN, e.speed * IDLE_SPEED_MUL, dt);
}

function stepSeek(e: EnemyEntity, tx: number, tz: number, dt: number): void {
  const rate = e.kind === 'shard' ? SHARD.params.turnRate : DEFAULT_TURN;
  steer(e, tx, tz, rate, e.speed, dt);
}

function stepDart(w: WorldState, e: EnemyEntity, tx: number, tz: number, dist: number, dt: number): void {
  const p = DART.params;
  switch (e.ai) {
    case AI_STATE.TELEGRAPH:
      stop(e);
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) {
        e.ai = AI_STATE.LUNGE;
        e.aiTimer = p.lungeTime;
      }
      return;
    case AI_STATE.LUNGE:
      e.vx = e.dirX * p.lungeSpeed;
      e.vz = e.dirZ * p.lungeSpeed;
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) {
        e.ai = AI_STATE.RECOVER;
        e.aiTimer = p.recover;
      }
      return;
    case AI_STATE.RECOVER:
      e.vx = e.dirX * e.speed * DART_RECOVER_SPEED_MUL;
      e.vz = e.dirZ * e.speed * DART_RECOVER_SPEED_MUL;
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) e.ai = AI_STATE.SEEK;
      return;
    default:
      if (dist <= p.triggerRange && dist > 1e-6) {
        e.ai = AI_STATE.TELEGRAPH;
        e.aiTimer = p.telegraph;
        e.dirX = (tx - e.x) / dist;
        e.dirZ = (tz - e.z) / dist;
        e.yaw = Math.atan2(e.dirX, e.dirZ);
        stop(e);
        emitTelegraph(w, 1, e.x, e.z, e.dirX, e.dirZ, p.lungeSpeed * p.lungeTime, p.telegraph);
        return;
      }
      e.ai = AI_STATE.SEEK;
      stepSeek(e, tx, tz, dt);
  }
}

function fireSpikerRing(w: WorldState, e: EnemyEntity): void {
  const n = SPIKER.params.bullets;
  const offset = (e.seed % 360) * DEG2RAD;
  for (let i = 0; i < n; i++) {
    const a = offset + (i * TAU) / n;
    fireEnemyShot(
      w,
      PROJECTILE_KINDS.enemySpike,
      e.x,
      e.z,
      a,
      SPIKER.shotSpeed,
      SPIKER.shotDamage,
      ENEMY_SHOT_RADIUS,
    );
  }
  emitEnemyShot(w, e.x, e.z, false);
}

function stepSpiker(w: WorldState, e: EnemyEntity, tx: number, tz: number, dist: number, dt: number): void {
  const p = SPIKER.params;
  if (e.ai === AI_STATE.CHARGE) {
    stop(e);
    e.aiTimer -= dt;
    if (e.aiTimer <= 0) {
      fireSpikerRing(w, e);
      e.shotTimer = p.interval;
      e.ai = AI_STATE.HOLD;
    }
    return;
  }
  e.shotTimer -= dt;
  if (e.shotTimer <= 0) {
    e.shotTimer = 0;
    if (dist <= p.keepRange + SPIKER_FIRE_SLACK) {
      e.ai = AI_STATE.CHARGE;
      e.aiTimer = p.pulse;
      stop(e);
      emitTelegraph(w, 0, e.x, e.z, 0, 1, SPIKER_TELEGRAPH_SIZE, p.pulse);
      return;
    }
  }
  if (e.ai === AI_STATE.HOLD && dist > p.keepRange * 1.25) e.ai = AI_STATE.SEEK;
  else if (e.ai !== AI_STATE.HOLD && dist <= p.keepRange) e.ai = AI_STATE.HOLD;
  if (e.ai !== AI_STATE.HOLD || dist < 1e-6) {
    stepSeek(e, tx, tz, dt);
    return;
  }
  // Orbit the target at keep range (clockwise or counter-clockwise by seed); back off when too close.
  const nx = (tx - e.x) / dist;
  const nz = (tz - e.z) / dist;
  const side = (e.seed & 1) === 0 ? 1 : -1;
  const radial = dist < p.keepRange * 0.6 ? -0.6 : 0;
  const s = e.speed * SPIKER_ORBIT_MUL;
  e.vx = (-nz * side + nx * radial) * s;
  e.vz = (nx * side + nz * radial) * s;
  e.yaw = Math.atan2(nx, nz);
  e.dirX = nx;
  e.dirZ = nz;
}

function stepWarden(w: WorldState, e: EnemyEntity, tx: number, tz: number, dist: number, dt: number): void {
  const p = WARDEN.params;
  const speed = dist <= WARDEN_STOP_DIST ? 0 : e.speed;
  steer(e, tx, tz, p.turnRate, speed, dt);
  e.ai = AI_STATE.SEEK;
  e.shotTimer -= dt;
  if (e.shotTimer > 0) return;
  e.shotTimer = 0;
  if (dist > WARDEN_FIRE_RANGE) return;
  const halfArc = p.shieldArcDeg * 0.5 * DEG2RAD;
  if (!inArc(e.yaw, halfArc, tx - e.x, tz - e.z)) return;
  const n = p.volleyShots;
  const spread = p.volleySpreadDeg * DEG2RAD;
  for (let i = 0; i < n; i++) {
    const a = e.yaw + (i - (n - 1) * 0.5) * spread;
    fireEnemyShot(
      w,
      PROJECTILE_KINDS.enemyOrb,
      e.x,
      e.z,
      a,
      WARDEN.shotSpeed,
      WARDEN.shotDamage,
      ENEMY_SHOT_RADIUS,
    );
  }
  emitEnemyShot(w, e.x, e.z, false);
  e.shotTimer = p.volleyInterval;
}

/** The link beam (or echo-drone beam) a Leech can reach: never in versus. */
function beamPresent(w: WorldState): boolean {
  return w.mode !== 'versus' && (w.link.active || w.link.cut);
}

function unlatch(w: WorldState, e: EnemyEntity): void {
  e.latched = 0;
  if (w.link.latchedCount > 0) w.link.latchedCount--;
}

/** Projection parameter of (x, z) on the beam segment, clamped to [0, 1]. */
function beamParam(w: WorldState, x: number, z: number): number {
  const l = w.link;
  const abx = l.bx - l.ax;
  const abz = l.bz - l.az;
  const l2 = abx * abx + abz * abz;
  if (l2 <= 1e-9) return 0;
  const t = ((x - l.ax) * abx + (z - l.az) * abz) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function stepLeech(
  w: WorldState,
  e: EnemyEntity,
  tx: number,
  tz: number,
  hasTarget: boolean,
  dt: number,
): void {
  const l = w.link;
  if (e.latched === 1) {
    if (!beamPresent(w)) {
      unlatch(w, e);
      e.ai = AI_STATE.SEEK;
    } else {
      if (e.ai !== AI_STATE.LATCHED) {
        const t = beamParam(w, e.x, e.z);
        e.aiTimer = t < LEECH_T_MIN ? LEECH_T_MIN : t > LEECH_T_MAX ? LEECH_T_MAX : t;
        e.ai = AI_STATE.LATCHED;
      }
      const px = l.ax + (l.bx - l.ax) * e.aiTimer;
      const pz = l.az + (l.bz - l.az) * e.aiTimer;
      const maxV = e.speed * LEECH_SNAP_MUL;
      let vx = (px - e.x) / dt;
      let vz = (pz - e.z) / dt;
      const v = Math.sqrt(vx * vx + vz * vz);
      if (v > maxV) {
        vx *= maxV / v;
        vz *= maxV / v;
      }
      e.vx = vx;
      e.vz = vz;
      return;
    }
  }
  if (e.ai === AI_STATE.LATCHED) {
    // Shed by a dash (or the beam vanished): tumble off briefly before seeking again.
    e.ai = AI_STATE.RECOVER;
    e.aiTimer = LEECH_KNOCKOFF;
  }
  if (e.ai === AI_STATE.RECOVER) {
    e.aiTimer -= dt;
    e.vx = -e.dirX * e.speed * 0.5;
    e.vz = -e.dirZ * e.speed * 0.5;
    if (e.aiTimer <= 0) e.ai = AI_STATE.SEEK;
    return;
  }
  if (beamPresent(w)) {
    const t = beamParam(w, e.x, e.z);
    steer(e, l.ax + (l.bx - l.ax) * t, l.az + (l.bz - l.az) * t, DEFAULT_TURN, e.speed, dt);
    return;
  }
  if (!hasTarget) {
    idle(e, dt);
    return;
  }
  stepSeek(e, tx, tz, dt);
}

/**
 * Runs one tick of e's behaviour: writes e.vx/e.vz (intended velocity), e.yaw/dirX/dirZ, e.ai/aiTimer and
 * fires shots. e.target must already be up to date (stepEnemies retargets).
 */
export function stepEnemyBehavior(w: WorldState, e: EnemyEntity, dt: number): void {
  const target = w.players[e.target];
  const hasTarget = isTargetable(target);
  const tx = target.x;
  const tz = target.z;
  const dx = tx - e.x;
  const dz = tz - e.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (e.kind === 'leech') {
    stepLeech(w, e, tx, tz, hasTarget, dt);
    return;
  }
  if (!hasTarget) {
    // A committed lunge still finishes; everything else drifts to the centre.
    if (e.kind === 'dart' && (e.ai === AI_STATE.LUNGE || e.ai === AI_STATE.RECOVER)) {
      stepDart(w, e, tx, tz, Infinity, dt);
      return;
    }
    idle(e, dt);
    return;
  }
  switch (e.kind) {
    case 'dart':
      stepDart(w, e, tx, tz, dist, dt);
      return;
    case 'spiker':
      stepSpiker(w, e, tx, tz, dist, dt);
      return;
    case 'warden':
      stepWarden(w, e, tx, tz, dist, dt);
      return;
    case 'shard':
    case 'fork':
      e.ai = AI_STATE.SEEK;
      stepSeek(e, tx, tz, dt);
      return;
  }
}
