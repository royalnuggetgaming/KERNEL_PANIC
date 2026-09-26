/**
 * Boss lifecycle over the fixed w.bosses records: spawn + intro, movement, phases at 66% / 33% HP, enrage at
 * 150 s, Fork Bomb splits (1 -> 2 -> 4), Race Condition twin-kill window, defeat (bossesKilled, drops).
 * A record is part of the current fight while maxHp > 0; it is reset (maxHp = 0) when the boss is defeated.
 */
import { BOSS_IDS, type BossId } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type { BossEntity } from '../contracts/sim';
import { SOURCE_WORLD } from '../contracts/simEvents';
import type { SimSystem, WorldState, WorldView } from '../contracts/world';
import { BOSS_COMMON, BOSS_DEFS, FORK_BOMB_SPLITS } from '../config/bosses';
import { COOP, ECONOMY } from '../config/tuning';
import { WAVES, waveHpMul } from '../config/waves';
import { runPattern, stepLasers } from './bossPatterns';
import {
  clampToArena,
  emitBossEvent,
  emitExplosionEvent,
  emitWaveEvent,
  nearestTarget,
} from './contentShared';
import { dropShards } from './pickups';

/** Bosses enter up-screen from the arena centre. */
export const BOSS_SPAWN_Z = -12;
/** Race Condition twins spawn this far either side of the centre line. */
export const TWIN_OFFSET_X = 7;
/** Preferred hover band around the target. */
const HOVER_NEAR = 7;
const HOVER_FAR = 10;
const STRAFE_MUL = 0.5;
const FLASH_DECAY = 8;
/** Fork Bomb children separate by this much on a split. */
const SPLIT_SPREAD = 2.2;

const CLAMP = { x: 0, z: 0 };

function resetRecord(b: BossEntity): void {
  b.alive = false;
  b.hp = 0;
  b.maxHp = 0;
  b.radius = 0;
  b.phase = 0;
  b.patternStep = 0;
  b.patternTimer = 0;
  b.stepCount = 0;
  b.aimAngle = 0;
  b.enraged = false;
  b.introTimer = 0;
  b.deathTime = -1;
  b.flash = 0;
  b.splitGen = 0;
  b.vx = 0;
  b.vz = 0;
  b.lastHitBy = SOURCE_WORLD;
}

/** HP multiplier for a boss: 2P x1.6, OVERFLOW waves add the +12%/wave growth past wave 15. */
export function bossHpMul(playerCount: 1 | 2, wave: number): number {
  const two = playerCount === 2 ? BOSS_COMMON.TWO_PLAYER_HP_MUL : 1;
  const overflow = wave > WAVES.TOTAL ? waveHpMul(wave) / waveHpMul(WAVES.TOTAL) : 1;
  return two * overflow;
}

/** Phase index for an hp fraction (thresholds 0.66 and 0.33). */
export function phaseForFraction(frac: number): 0 | 1 | 2 {
  if (frac <= BOSS_COMMON.PHASE_THRESHOLDS[1]) return 2;
  if (frac <= BOSS_COMMON.PHASE_THRESHOLDS[0]) return 1;
  return 0;
}

/** Twin-kill window: 6 s solo, 3 s with two players. */
export function raceWindow(playerCount: 1 | 2): number {
  return playerCount === 1 ? COOP.RACE_WINDOW_SOLO : COOP.RACE_WINDOW_COOP;
}

/** Uses w.bosses records, 2P HP x1.6, intro (players invulnerable for the intro). */
export function spawnBoss(w: WorldState, id: BossId): void {
  const def = BOSS_DEFS[id];
  const hp = def.hp * bossHpMul(w.run.playerCount, w.run.wave);
  for (let i = 0; i < w.bosses.length; i++) resetRecord(w.bosses[i]!);
  w.lasers.clear();
  for (let k = 0; k < def.parts && k < w.bosses.length; k++) {
    const b = w.bosses[k]!;
    b.id = id;
    b.alive = true;
    b.hp = hp;
    b.maxHp = hp;
    b.radius = def.radius;
    const x = def.parts === 1 ? 0 : k === 0 ? -TWIN_OFFSET_X : TWIN_OFFSET_X;
    b.x = b.prevX = x;
    b.z = b.prevZ = BOSS_SPAWN_Z;
    b.yaw = b.prevYaw = 0;
    b.introTimer = BOSS_COMMON.INTRO_TIME;
    emitBossEvent(w, id, b.part, 'intro', b.x, b.z);
  }
  const until = w.time + BOSS_COMMON.INTRO_TIME;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i === 0 ? 0 : 1];
    if (p.life !== 'absent' && p.invulnUntil < until) p.invulnUntil = until;
  }
  emitWaveEvent(w, 'bossSpawn', BOSS_IDS.indexOf(id), -1);
}

/** True while any part of the current boss is alive or waiting for a Race Condition respawn. */
export function bossAlive(w: WorldView): boolean {
  for (let i = 0; i < w.bosses.length; i++) {
    const b = w.bosses[i]!;
    if (b.maxHp > 0 && (b.alive || b.deathTime >= 0)) return true;
  }
  return false;
}

function freeRecord(w: WorldState): BossEntity | null {
  for (let i = 0; i < w.bosses.length; i++) {
    const b = w.bosses[i]!;
    if (!b.alive && b.maxHp === 0) return b;
  }
  return null;
}

function setPhase(w: WorldState, b: BossEntity, phase: 0 | 1 | 2): void {
  if (phase === b.phase) return;
  b.phase = phase;
  b.patternStep = 0;
  b.patternTimer = 0;
  b.stepCount = 0;
  emitBossEvent(w, b.id, b.part, 'phase', b.x, b.z);
  emitWaveEvent(w, 'bossPhase', phase, -1);
}

/** Fork Bomb: a part at or below its split threshold halves and a sibling takes the other half. */
function forkSplit(w: WorldState, b: BossEntity): void {
  const gen = b.splitGen;
  const threshold = FORK_BOMB_SPLITS[gen];
  if (threshold === undefined || b.hp > b.maxHp * threshold) return;
  b.splitGen = gen + 1;
  const c = freeRecord(w);
  if (c === null) return;
  b.hp *= 0.5;
  b.maxHp *= 0.5;
  const nx = Math.cos(b.yaw);
  const nz = -Math.sin(b.yaw);
  c.id = b.id;
  c.alive = true;
  c.hp = b.hp;
  c.maxHp = b.maxHp;
  c.radius = b.radius;
  c.phase = b.phase;
  c.patternStep = 0;
  c.patternTimer = 0;
  c.stepCount = 0;
  c.aimAngle = b.aimAngle + Math.PI;
  c.enraged = b.enraged;
  c.introTimer = 0;
  c.deathTime = -1;
  c.flash = 0;
  c.splitGen = b.splitGen;
  c.lastHitBy = b.lastHitBy;
  c.yaw = c.prevYaw = b.yaw;
  c.x = c.prevX = b.x + nx * SPLIT_SPREAD;
  c.z = c.prevZ = b.z + nz * SPLIT_SPREAD;
  c.vx = 0;
  c.vz = 0;
  b.x -= nx * SPLIT_SPREAD;
  b.z -= nz * SPLIT_SPREAD;
  b.patternStep = 0;
  b.patternTimer = 0;
  b.stepCount = 0;
  emitBossEvent(w, b.id, c.part, 'split', c.x, c.z);
  emitExplosionEvent(w, b.x, b.z, b.radius * 1.5, 0.6);
}

function drift(w: WorldState, b: BossEntity, speed: number): void {
  const t = nearestTarget(w, b.x, b.z);
  if (t === -1) {
    b.vx = 0;
    b.vz = 0;
    return;
  }
  const p = w.players[t];
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) {
    b.vx = 0;
    b.vz = 0;
    return;
  }
  const nx = dx / d;
  const nz = dz / d;
  b.yaw = Math.atan2(nx, nz);
  if (d > HOVER_FAR) {
    b.vx = nx * speed;
    b.vz = nz * speed;
  } else if (d < HOVER_NEAR) {
    b.vx = -nx * speed;
    b.vz = -nz * speed;
  } else {
    const side = (b.part & 1) === 0 ? 1 : -1;
    b.vx = -nz * side * speed * STRAFE_MUL;
    b.vz = nx * side * speed * STRAFE_MUL;
  }
}

function defeat(w: WorldState, x: number, z: number): void {
  const id = w.bosses[0]!.id;
  if (w.mode !== 'versus') w.run.bossesKilled++;
  dropShards(w, x, z, ECONOMY.BOSS_SHARDS);
  emitExplosionEvent(w, x, z, 8, 1);
  emitWaveEvent(w, 'bossDead', BOSS_IDS.indexOf(id), -1);
  w.lasers.clear();
  for (let i = 0; i < w.bosses.length; i++) resetRecord(w.bosses[i]!);
}

function stepPart(w: WorldState, b: BossEntity, dt: number): void {
  const def = BOSS_DEFS[b.id];
  if (b.introTimer > 0) {
    b.introTimer = b.introTimer > dt ? b.introTimer - dt : 0;
    b.vx = 0;
    b.vz = 0;
    return;
  }
  if (b.id === 'forkBomb') forkSplit(w, b);
  setPhase(w, b, phaseForFraction(b.maxHp > 0 ? b.hp / b.maxHp : 0));
  drift(w, b, def.speed);
  const steps = def.phases[b.phase].steps;
  const step = steps[b.patternStep % steps.length]!;
  const rate = b.enraged ? BOSS_COMMON.ENRAGE_RATE_MUL : 1;
  if (runPattern(w, b, step, dt * rate)) {
    b.patternStep = (b.patternStep + 1) % steps.length;
    b.patternTimer = 0;
    b.stepCount = 0;
  }
  clampToArena(b.x + b.vx * dt, b.z + b.vz * dt, b.radius, CLAMP);
  b.x = CLAMP.x;
  b.z = CLAMP.z;
}

function checkEnrage(w: WorldState): void {
  if (w.run.phase !== 'boss' || w.run.waveDuration <= 0 || w.run.waveTimer > 0) return;
  for (let i = 0; i < w.bosses.length; i++) {
    const b = w.bosses[i]!;
    if (b.maxHp <= 0 || b.enraged) continue;
    b.enraged = true;
    emitBossEvent(w, b.id, b.part, 'enrage', b.x, b.z);
    if (i === 0) emitWaveEvent(w, 'bossEnrage', 1, -1);
  }
}

function stepBossImpl(w: WorldState, _intents: Intents, dt: number): void {
  stepLasers(w, dt);
  if (!bossAlive(w)) return;
  const acting = w.run.phase === 'boss' || w.run.phase === 'combat';
  checkEnrage(w);
  const n = w.bosses.length;
  for (let i = 0; i < n; i++) {
    const b = w.bosses[i]!;
    if (!b.alive) continue;
    b.prevX = b.x;
    b.prevZ = b.z;
    b.prevYaw = b.yaw;
    b.flash = b.flash > 0 ? Math.max(0, b.flash - FLASH_DECAY * dt) : 0;
    if (b.hp <= 0) continue;
    if (acting) stepPart(w, b, dt);
    else {
      b.vx = 0;
      b.vz = 0;
    }
  }
  // Deaths (hp was clamped at 0 by applyBossDamage during collision last tick).
  let died = 0;
  let lastX = 0;
  let lastZ = 0;
  for (let i = 0; i < n; i++) {
    const b = w.bosses[i]!;
    if (!b.alive || b.hp > 0) continue;
    b.alive = false;
    b.deathTime = w.time;
    b.vx = 0;
    b.vz = 0;
    died++;
    lastX = b.x;
    lastZ = b.z;
    emitBossEvent(w, b.id, b.part, 'dead', b.x, b.z);
    emitExplosionEvent(w, b.x, b.z, b.radius * 2, 0.8);
  }
  let anyAlive = false;
  for (let i = 0; i < n; i++) if (w.bosses[i]!.alive) anyAlive = true;
  if (died > 0 && !anyAlive) {
    defeat(w, lastX, lastZ);
    return;
  }
  // Race Condition: a twin dead longer than the window respawns at 50% while its partner lives.
  if (!anyAlive) return;
  const window = raceWindow(w.run.playerCount);
  for (let i = 0; i < n; i++) {
    const b = w.bosses[i]!;
    if (b.alive || b.maxHp <= 0 || b.id !== 'raceCondition' || b.deathTime < 0) continue;
    if (w.time - b.deathTime < window) continue;
    b.alive = true;
    b.hp = b.maxHp * COOP.RACE_RESPAWN_FRAC;
    b.deathTime = -1;
    b.patternStep = 0;
    b.patternTimer = 0;
    b.stepCount = 0;
    b.phase = phaseForFraction(COOP.RACE_RESPAWN_FRAC);
    emitBossEvent(w, b.id, b.part, 'respawn', b.x, b.z);
  }
}

/** phases at 66/33%, enrage at 150 s, Race Condition window (3 s co-op / 6 s solo), Fork Bomb splits, death -> bossesKilled + drops */
export const stepBoss: SimSystem = stepBossImpl;
