/**
 * Per-kind enemy behaviour state machines (plan section 8 "enemyBehaviors.ts"):
 * seek (Shard, Fork), telegraph-lunge (Dart), ring-burst (Spiker), shielded advance + volley (Warden),
 * beam latch (Leech). Behaviours only write intent (velocity, facing, ai state) and fire enemy shots;
 * stepEnemies integrates positions and applies separation. Allocation-free.
 */
import { PROJECTILE_KINDS, type EnemyEntity } from '../contracts/sim';
import type { WorldState } from '../contracts/world';
import { difficultyDef } from '../config/difficulty';
import { ENEMY_DEFS } from '../config/enemies';
import { DEG2RAD, TAU } from '../core/math';
import {
  ENEMY_MUZZLE,
  ENEMY_SHOT_RADIUS,
  MUZZLE_DAMAGE,
  MUZZLE_RADIUS,
  MUZZLE_SPEED,
  MUZZLE_X,
  MUZZLE_YAW,
  MUZZLE_Z,
  emitEnemyShotAtMuzzle,
  emitTelegraph,
  fireEnemyShotAt,
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

/** Current behaviour target [x, z, distance] (scratch: handlers read it instead of taking boxed doubles). */
const TGT = new Float64Array(3);
const SHARD = ENEMY_DEFS.shard;
const DART = ENEMY_DEFS.dart;
const SPIKER = ENEMY_DEFS.spiker;
const WARDEN = ENEMY_DEFS.warden;
const WARDEN_HALF_ARC = WARDEN.params.shieldArcDeg * 0.5 * DEG2RAD;

/** Steering request [target x, target z, turn rate rad/s, speed] (scratch, read by steer). */
const STEER = new Float64Array(4);
/** stepLeech's beam projection parameter [t] (scratch, written by beamParam). */
const BEAM_T = new Float64Array(1);

/**
 * Turns e toward the STEER target at the STEER rate and moves along its facing at the STEER speed. Targets and
 * rates travel through scratch arrays: a handler call TurboFan does not inline would box every double argument
 * (turnToward/wrapAngle arithmetic is inlined here for the same reason).
 */
function steer(e: EnemyEntity, dt: number): void {
  const dx = STEER[0]! - e.x;
  const dz = STEER[1]! - e.z;
  if (dx * dx + dz * dz > 1e-8) {
    const target = Math.atan2(dx, dz);
    const maxStep = STEER[2]! * dt;
    let d = (target - e.yaw) % TAU;
    if (d <= -Math.PI) d += TAU;
    else if (d > Math.PI) d -= TAU;
    let y = d > maxStep ? e.yaw + maxStep : d < -maxStep ? e.yaw - maxStep : target;
    y %= TAU;
    if (y <= -Math.PI) y += TAU;
    else if (y > Math.PI) y -= TAU;
    e.yaw = y;
  }
  const speed = STEER[3]!;
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
  STEER[0] = 0;
  STEER[1] = 0;
  STEER[2] = DEFAULT_TURN;
  STEER[3] = e.speed * IDLE_SPEED_MUL;
  steer(e, dt);
}

function stepSeek(e: EnemyEntity, dt: number): void {
  STEER[0] = TGT[0]!;
  STEER[1] = TGT[1]!;
  STEER[2] = e.kind === 'shard' ? SHARD.params.turnRate : DEFAULT_TURN;
  STEER[3] = e.speed;
  steer(e, dt);
}

function stepDart(w: WorldState, e: EnemyEntity, dt: number): void {
  const tx = TGT[0]!;
  const tz = TGT[1]!;
  const dist = TGT[2]!;
  const p = DART.params;
  const lungeSpeed = p.lungeSpeed * difficultyDef(w.config.difficulty).speed;
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
      e.vx = e.dirX * lungeSpeed;
      e.vz = e.dirZ * lungeSpeed;
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
        emitTelegraph(w, 1, e.x, e.z, e.dirX, e.dirZ, lungeSpeed * p.lungeTime, p.telegraph);
        return;
      }
      e.ai = AI_STATE.SEEK;
      stepSeek(e, dt);
  }
}

/** Loads e's muzzle and the standard enemy bullet radius into ENEMY_MUZZLE (speed, damage, yaw by caller). */
function aimMuzzle(e: Readonly<EnemyEntity>): void {
  ENEMY_MUZZLE[MUZZLE_X] = e.x;
  ENEMY_MUZZLE[MUZZLE_Z] = e.z;
  ENEMY_MUZZLE[MUZZLE_RADIUS] = ENEMY_SHOT_RADIUS;
}

function fireSpikerRing(w: WorldState, e: EnemyEntity): void {
  const n = SPIKER.params.bullets;
  const offset = (e.seed % 360) * DEG2RAD;
  aimMuzzle(e);
  ENEMY_MUZZLE[MUZZLE_SPEED] = SPIKER.shotSpeed;
  ENEMY_MUZZLE[MUZZLE_DAMAGE] = SPIKER.shotDamage;
  for (let i = 0; i < n; i++) {
    ENEMY_MUZZLE[MUZZLE_YAW] = offset + (i * TAU) / n;
    fireEnemyShotAt(w, PROJECTILE_KINDS.enemySpike);
  }
  emitEnemyShotAtMuzzle(w, false);
}

function stepSpiker(w: WorldState, e: EnemyEntity, dt: number): void {
  const tx = TGT[0]!;
  const tz = TGT[1]!;
  const dist = TGT[2]!;
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
    stepSeek(e, dt);
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

/** core/math inArc(e.yaw, WARDEN_HALF_ARC, target - e), same arithmetic, reading the target from TGT. */
function shieldFacesTarget(e: Readonly<EnemyEntity>): boolean {
  const dx = TGT[0]! - e.x;
  const dz = TGT[1]! - e.z;
  if (dx === 0 && dz === 0) return false;
  let d = (Math.atan2(dx, dz) - e.yaw) % TAU;
  if (d <= -Math.PI) d += TAU;
  else if (d > Math.PI) d -= TAU;
  return Math.abs(d) <= WARDEN_HALF_ARC;
}

function stepWarden(w: WorldState, e: EnemyEntity, dt: number): void {
  const tx = TGT[0]!;
  const tz = TGT[1]!;
  const dist = TGT[2]!;
  const p = WARDEN.params;
  STEER[0] = tx;
  STEER[1] = tz;
  STEER[2] = p.turnRate;
  STEER[3] = dist <= WARDEN_STOP_DIST ? 0 : e.speed;
  steer(e, dt);
  e.ai = AI_STATE.SEEK;
  e.shotTimer -= dt;
  if (e.shotTimer > 0) return;
  e.shotTimer = 0;
  if (dist > WARDEN_FIRE_RANGE) return;
  if (!shieldFacesTarget(e)) return;
  const n = p.volleyShots;
  const spread = p.volleySpreadDeg * DEG2RAD;
  aimMuzzle(e);
  ENEMY_MUZZLE[MUZZLE_SPEED] = WARDEN.shotSpeed;
  ENEMY_MUZZLE[MUZZLE_DAMAGE] = WARDEN.shotDamage;
  for (let i = 0; i < n; i++) {
    ENEMY_MUZZLE[MUZZLE_YAW] = e.yaw + (i - (n - 1) * 0.5) * spread;
    fireEnemyShotAt(w, PROJECTILE_KINDS.enemyOrb);
  }
  emitEnemyShotAtMuzzle(w, false);
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

/** Projection parameter of e on the beam segment, clamped to [0, 1], written to BEAM_T[0]. */
function beamParam(w: WorldState, e: Readonly<EnemyEntity>): void {
  const l = w.link;
  const abx = l.bx - l.ax;
  const abz = l.bz - l.az;
  const l2 = abx * abx + abz * abz;
  if (l2 <= 1e-9) {
    BEAM_T[0] = 0;
    return;
  }
  const t = ((e.x - l.ax) * abx + (e.z - l.az) * abz) / l2;
  BEAM_T[0] = t < 0 ? 0 : t > 1 ? 1 : t;
}

function stepLeech(w: WorldState, e: EnemyEntity, hasTarget: boolean, dt: number): void {
  const l = w.link;
  if (e.latched === 1) {
    if (!beamPresent(w)) {
      unlatch(w, e);
      e.ai = AI_STATE.SEEK;
    } else {
      if (e.ai !== AI_STATE.LATCHED) {
        beamParam(w, e);
        const t = BEAM_T[0]!;
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
    beamParam(w, e);
    const t = BEAM_T[0]!;
    STEER[0] = l.ax + (l.bx - l.ax) * t;
    STEER[1] = l.az + (l.bz - l.az) * t;
    STEER[2] = DEFAULT_TURN;
    STEER[3] = e.speed;
    steer(e, dt);
    return;
  }
  if (!hasTarget) {
    idle(e, dt);
    return;
  }
  stepSeek(e, dt);
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
  TGT[0] = tx;
  TGT[1] = tz;
  TGT[2] = dist;
  if (e.kind === 'leech') {
    stepLeech(w, e, hasTarget, dt);
    return;
  }
  if (!hasTarget) {
    // A committed lunge still finishes; everything else drifts to the centre.
    if (e.kind === 'dart' && (e.ai === AI_STATE.LUNGE || e.ai === AI_STATE.RECOVER)) {
      TGT[2] = Infinity;
      stepDart(w, e, dt);
      return;
    }
    idle(e, dt);
    return;
  }
  switch (e.kind) {
    case 'dart':
      stepDart(w, e, dt);
      return;
    case 'spiker':
      stepSpiker(w, e, dt);
      return;
    case 'warden':
      stepWarden(w, e, dt);
      return;
    case 'shard':
    case 'fork':
      e.ai = AI_STATE.SEEK;
      stepSeek(e, dt);
      return;
  }
}
