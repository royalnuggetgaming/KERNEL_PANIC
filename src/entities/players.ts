/**
 * Player movement system: inertia (accel/decel), focus slow, facing + aim assist, dash (i-frames, charges,
 * Bulwark ram, Leech shedding), downed crawl, Offline ghost view clamp, arena clamp, prev-transform copy and
 * the soft push between craft. Also applyPlayerStats and the versus round reset.
 */
import type { PlayerIndex, RunMode } from '../contracts/ids';
import type { Intents, PlayerIntent } from '../contracts/input';
import type { PlayerEntity } from '../contracts/sim';
import { NUMERIC_STATS, type DerivedStats } from '../contracts/upgrades';
import type { SimSystem, WorldState } from '../contracts/world';
import { DEG2RAD, TAU } from '../core/math';
import { COOP, DASH, MOVEMENT, STAT_CAPS } from '../config/tuning';
import { VERSUS } from '../config/versus';
import { beginRam, clampGhostToView, clampToArena, shedLeeches, stepRam } from './playerDash';
import { emitPlayer } from './simEventsOut';

/** Players face up the screen (-Z) at spawn (mirrors sim/worldRecords SPAWN_YAW; entities cannot import sim/). */
export const PLAYER_SPAWN_YAW = Math.PI;
const TURN_RATE = MOVEMENT.TURN_RATE_DEG * DEG2RAD;
const AIM_HALF = MOVEMENT.AIM_ASSIST_HALF_DEG * DEG2RAD;
const AIM_COS = Math.cos(AIM_HALF);
const AIM_RANGE_SQ = MOVEMENT.AIM_ASSIST_RANGE * MOVEMENT.AIM_ASSIST_RANGE;
const DASH_SPEED = DASH.DISTANCE / DASH.DURATION;
const HIT_FLASH_DECAY = 4;

/** Spawn position for a player in a mode (same rule as sim/worldRecords spawnPosition). */
export function playerSpawnPosition(mode: RunMode, index: PlayerIndex, out: { x: number; z: number }): void {
  const side = index === 0 ? -1 : 1;
  out.z = 0;
  if (mode === 'solo') out.x = 0;
  else if (mode === 'versus') out.x = side * VERSUS.SPAWN_OFFSET;
  else out.x = side * 3;
}

function maxDashCharges(p: Readonly<PlayerEntity>): number {
  const c = Math.floor(p.stats.dashCharges);
  return c < 1 ? 1 : c > STAT_CAPS.dashChargesMax ? STAT_CAPS.dashChargesMax : c;
}

/** Sets stats; max-HP increases heal by the delta, decreases clamp hp to >= 1. Also clamps dash charges. */
export function applyPlayerStats(p: PlayerEntity, stats: DerivedStats): void {
  const delta = stats.maxHp - p.stats.maxHp;
  for (let i = 0; i < NUMERIC_STATS.length; i++) {
    const k = NUMERIC_STATS[i]!;
    p.stats[k] = stats[k];
  }
  if (p.life === 'absent') return;
  if (delta > 0 && p.life === 'alive') p.hp += delta;
  if (p.hp > stats.maxHp) p.hp = stats.maxHp;
  if (p.life === 'alive' && p.hp < 1) p.hp = 1;
  const max = maxDashCharges(p);
  if (p.dashCharges > max) p.dashCharges = max;
}

const SPAWN = { x: 0, z: 0 };

/** Versus round start / respawn helper: position at spawnPosition(), full hp, reset dash/special/overdrive/flags. */
export function resetPlayersForRound(w: WorldState): void {
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    if (p.life === 'absent') continue;
    playerSpawnPosition(w.mode, p.index, SPAWN);
    p.x = p.prevX = SPAWN.x;
    p.z = p.prevZ = SPAWN.z;
    p.yaw = p.prevYaw = PLAYER_SPAWN_YAW;
    p.vx = p.vz = 0;
    p.life = 'alive';
    p.hp = p.stats.maxHp;
    p.invulnUntil = 0;
    p.hitFlash = 0;
    p.dashTimer = 0;
    p.dashCooldownLeft = 0;
    p.dashCharges = maxDashCharges(p);
    p.dashDirX = 0;
    p.dashDirZ = 0;
    p.fireAcc = 0;
    p.aimX = 0;
    p.aimZ = -1;
    p.overdrive = 0;
    const s = p.special;
    s.active = false;
    s.timer = 0;
    s.duration = 0;
    s.fireAcc = 0;
    s.pendingCasts = 0;
    const c = p.cards;
    c.missileTimer = 0;
    c.nanoshieldTimer = 0;
    c.nanoshieldReady = false;
    c.orbitAngle = 0;
    c.overheatActive = false;
    c.forkShotCounter = 0;
    c.trailHead = 0;
    c.trailCount = 0;
    c.trailTimer = 0;
    p.bleedLeft = 0;
    p.downsThisWave = 0;
    p.downedAt = -1;
    p.reviveProgress = 0;
    p.respawnTimer = 0;
    p.contactCd = 0;
    p.combo = 0;
    p.comboTimer = 0;
    p.comboTier = 0;
  }
}

/**
 * accelerate() inputs [tx, tz, rate * dt]: written by the caller instead of passed, because doubles passed to a
 * call that is not inlined are boxed (per player per step).
 */
const ACCEL_IN = new Float64Array(3);

/** Moves (vx, vz) toward (tx, tz) = ACCEL_IN[0..1] by at most ACCEL_IN[2] (rate * dt). */
function accelerate(p: PlayerEntity): void {
  const tx = ACCEL_IN[0]!;
  const tz = ACCEL_IN[1]!;
  const dx = tx - p.vx;
  const dz = tz - p.vz;
  const l = Math.sqrt(dx * dx + dz * dz);
  const step = ACCEL_IN[2]!;
  if (l <= step) {
    p.vx = tx;
    p.vz = tz;
  } else {
    p.vx += (dx / l) * step;
    p.vz += (dz / l) * step;
  }
}

function rechargeDash(p: PlayerEntity, dt: number): void {
  const max = maxDashCharges(p);
  if (p.dashCharges >= max) {
    p.dashCharges = max;
    p.dashCooldownLeft = 0;
    return;
  }
  if (p.dashCooldownLeft <= 0) p.dashCooldownLeft = p.stats.dashCooldown;
  p.dashCooldownLeft -= dt;
  if (p.dashCooldownLeft <= 0) {
    p.dashCharges++;
    p.dashCooldownLeft = p.dashCharges < max ? p.stats.dashCooldown : 0;
  }
}

function startDash(w: WorldState, p: PlayerEntity, it: PlayerIntent): void {
  let dx = it.moveX;
  let dz = it.moveZ;
  let l = Math.sqrt(dx * dx + dz * dz);
  if (l < 1e-6) {
    dx = Math.sin(p.yaw);
    dz = Math.cos(p.yaw);
    l = 1;
  }
  p.dashDirX = dx / l;
  p.dashDirZ = dz / l;
  p.dashCharges--;
  if (p.dashCooldownLeft <= 0) p.dashCooldownLeft = p.stats.dashCooldown;
  p.dashTimer = DASH.DURATION;
  const until = w.time + DASH.IFRAMES;
  if (until > p.invulnUntil) p.invulnUntil = until;
  beginRam(w, p.index);
  if (w.mode !== 'versus') shedLeeches(w);
  emitPlayer(w, p.index, 'dash', p.dashCharges, p.x, p.z);
}

/** Aim assist: nearest target inside the +-10 deg cone within 24 u, else the facing direction. */
function updateAim(w: WorldState, p: PlayerEntity): void {
  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  let bestD = AIM_RANGE_SQ;
  let ax = fx;
  let az = fz;
  const pool = w.enemies;
  for (let i = 0; i < pool.count; i++) {
    const e = pool.active[i]!;
    if (e.dying) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = dx * dx + dz * dz;
    if (d >= bestD || d < 1e-9) continue;
    const l = Math.sqrt(d);
    if ((dx * fx + dz * fz) / l < AIM_COS) continue;
    bestD = d;
    ax = dx / l;
    az = dz / l;
  }
  for (let b = 0; b < w.bosses.length; b++) {
    const boss = w.bosses[b]!;
    if (!boss.alive || boss.introTimer > 0) continue;
    const dx = boss.x - p.x;
    const dz = boss.z - p.z;
    const d = dx * dx + dz * dz;
    if (d >= bestD || d < 1e-9) continue;
    const l = Math.sqrt(d);
    if ((dx * fx + dz * fz) / l < AIM_COS) continue;
    bestD = d;
    ax = dx / l;
    az = dz / l;
  }
  if (w.mode === 'versus') {
    const q = w.players[p.index === 0 ? 1 : 0];
    if (q.life === 'alive') {
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD && d > 1e-9) {
        const l = Math.sqrt(d);
        if ((dx * fx + dz * fz) / l >= AIM_COS) {
          ax = dx / l;
          az = dz / l;
        }
      }
    }
  }
  p.aimX = ax;
  p.aimZ = az;
}

/** core/math wrapAngle's arithmetic, in place on YAW[0] (no double crosses a call). */
const YAW = new Float64Array(1);
function wrapYaw(): void {
  let r = YAW[0]! % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  YAW[0] = r;
}

/** p.yaw = turnToward(p.yaw, atan2(moveX, moveZ), TURN_RATE * dt), same arithmetic, without boxed arguments. */
function turnToMove(p: PlayerEntity, it: Readonly<PlayerIntent>, dt: number): void {
  const current = p.yaw;
  const target = Math.atan2(it.moveX, it.moveZ);
  const maxStep = TURN_RATE * dt;
  YAW[0] = target - current;
  wrapYaw();
  const d = YAW[0];
  YAW[0] = d > maxStep ? current + maxStep : d < -maxStep ? current - maxStep : target;
  wrapYaw();
  p.yaw = YAW[0]!;
}

function stepAlive(w: WorldState, p: PlayerEntity, it: PlayerIntent, dt: number): void {
  rechargeDash(p, dt);
  if (it.dashPressed && p.dashTimer <= 0 && p.dashCharges >= 1) startDash(w, p, it);
  const moving = it.moveX !== 0 || it.moveZ !== 0;
  if (p.dashTimer > 0) {
    // The dash covers exactly DASH.DISTANCE: only the remaining dash time moves at dash speed.
    const dashStep = p.dashTimer < dt ? p.dashTimer : dt;
    p.dashTimer -= dt;
    const sp = p.stats.moveSpeed;
    p.x += p.dashDirX * (DASH_SPEED * dashStep + sp * (dt - dashStep));
    p.z += p.dashDirZ * (DASH_SPEED * dashStep + sp * (dt - dashStep));
    if (p.dashTimer <= 0) {
      p.dashTimer = 0;
      p.vx = p.dashDirX * sp;
      p.vz = p.dashDirZ * sp;
    } else {
      p.vx = p.dashDirX * DASH_SPEED;
      p.vz = p.dashDirZ * DASH_SPEED;
    }
    stepRam(w, p);
  } else {
    const speed = p.stats.moveSpeed * (it.focusHeld ? MOVEMENT.FOCUS_MOVE_MUL : 1);
    ACCEL_IN[0] = it.moveX * speed;
    ACCEL_IN[1] = it.moveZ * speed;
    ACCEL_IN[2] = (moving ? MOVEMENT.ACCEL : MOVEMENT.DECEL) * dt;
    accelerate(p);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
  }
  if (!it.focusHeld && moving) turnToMove(p, it, dt);
  clampToArena(p);
  updateAim(w, p);
}

function stepDowned(w: WorldState, p: PlayerEntity, it: PlayerIntent, dt: number): void {
  if (w.mode === 'versus') {
    p.vx = p.vz = 0;
    return;
  }
  const speed = p.stats.moveSpeed * COOP.DOWNED_CRAWL_MUL;
  p.vx = it.moveX * speed;
  p.vz = it.moveZ * speed;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  clampToArena(p);
}

function stepGhost(w: WorldState, p: PlayerEntity, it: PlayerIntent, dt: number): void {
  const speed = p.stats.moveSpeed;
  ACCEL_IN[0] = it.moveX * speed;
  ACCEL_IN[1] = it.moveZ * speed;
  ACCEL_IN[2] = (it.moveX !== 0 || it.moveZ !== 0 ? MOVEMENT.ACCEL : MOVEMENT.DECEL) * dt;
  accelerate(p);
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  clampGhostToView(w, p);
}

function physical(p: Readonly<PlayerEntity>): boolean {
  return p.life === 'alive' || p.life === 'downed';
}

/** Soft push-apart between the two craft (co-op and versus). */
function softPush(w: WorldState, dt: number): void {
  const a = w.players[0];
  const b = w.players[1];
  if (!physical(a) || !physical(b)) return;
  const rs = a.radius + b.radius;
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= rs) return;
  if (d < 1e-6) {
    dx = a.index === 0 ? 1 : -1;
    dz = 0;
  } else {
    dx /= d;
    dz /= d;
  }
  const overlap = rs - d;
  const push = MOVEMENT.SOFT_PUSH * (overlap / rs) * dt * 0.5;
  a.x -= dx * push;
  a.z -= dz * push;
  b.x += dx * push;
  b.z += dz * push;
  clampToArena(a);
  clampToArena(b);
}

export const stepPlayers: SimSystem = (w: WorldState, intents: Intents, dt: number): void => {
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    if (p.life === 'absent') continue;
    p.prevX = p.x;
    p.prevZ = p.z;
    p.prevYaw = p.yaw;
    if (p.contactCd > 0) p.contactCd -= dt;
    if (p.hitFlash > 0) {
      p.hitFlash -= HIT_FLASH_DECAY * dt;
      if (p.hitFlash < 0) p.hitFlash = 0;
    }
    const it = intents[i as PlayerIndex];
    switch (p.life) {
      case 'alive':
        stepAlive(w, p, it, dt);
        break;
      case 'downed':
        stepDowned(w, p, it, dt);
        break;
      case 'offline':
        stepGhost(w, p, it, dt);
        break;
      case 'respawning':
        p.vx = p.vz = 0;
        break;
    }
  }
  softPush(w, dt);
};
