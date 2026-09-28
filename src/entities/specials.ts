/**
 * Specials (Overdrive 0..100): Railburst, Firewall, Blink Swarm and Patch Drone, Special Tuning tiers (+25%
 * radius/duration/damage each) and SUDO (the special fires twice). Versus: Railburst and Blink mines hit the
 * opponent at PVP_SPECIAL_DAMAGE_MUL (damagePlayer applies it), the Patch Drone heals only its owner.
 */
import { NO_HANDLE, type PlayerIndex, type SpecialKind } from '../contracts/ids';
import type { Intents, PlayerIntent } from '../contracts/input';
import { PROJECTILE_KINDS, type EnemyEntity, type PlayerEntity, type ProjectileSpec } from '../contracts/sim';
import type { SimSystem, WorldState } from '../contracts/world';
import { pointSegDistSq } from '../core/math';
import { SPECIALS, specialTierMul } from '../config/specials';
import { ARENA, OVERDRIVE, STAT_CAPS } from '../config/tuning';
import { VEHICLES } from '../config/vehicles';
import { CARD_BIT, hasCard } from './cardBits';
import { HIT_IN, applyBossDamage, damagePlayer, hitEnemy } from './damage';
import { NEAREST, nearestTarget, spawnProjectile } from './projectiles';
import { emitPlayer } from './simEventsOut';

export { addOverdrive } from './overdrive';

/** Visual lifetime of the Blink Swarm special state. */
export const BLINK_VISUAL_TIME = 0.3;
/** Blink grants brief i-frames on arrival. */
export const BLINK_IFRAMES = 0.2;
export const DRONE_ORBIT_SPEED = 2;
export const TURRET_SHOT_SPEED = 40;
export const TURRET_SHOT_RADIUS = 0.2;
/** Timers within this of zero have expired (repeated 1/120 s decrements do not land exactly on 0). */
const TIMER_EPS = 1e-9;

const SPEC: ProjectileSpec = {
  side: 'player',
  owner: 0,
  kind: PROJECTILE_KINDS.mine,
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

function tierOf(p: Readonly<PlayerEntity>): number {
  const t = Math.round(p.stats.specialTier);
  return t < 0 ? 0 : t > STAT_CAPS.specialTierMax ? STAT_CAPS.specialTierMax : t;
}

function emitSpecial(w: WorldState, p: PlayerEntity): void {
  const s = p.special;
  const e = w.events.special.push();
  e.player = p.index;
  e.kind = s.kind;
  e.x = s.x;
  e.z = s.z;
  e.dirX = s.dirX;
  e.dirZ = s.dirZ;
  e.radius = s.radius;
  e.duration = s.duration;
  emitPlayer(w, p.index, 'special', s.tier, p.x, p.z);
}

/** Rail being resolved: [ax, az, bx, bz, half width, damage] (scratch for the per-enemy test and hit). */
const RAIL = new Float64Array(6);

/** core/math pointSegDistSq(e, rail) <= (half + e.radius)^2, same arithmetic, reading the rail from RAIL. */
function railTouches(e: Readonly<EnemyEntity>): boolean {
  const ax = RAIL[0]!;
  const az = RAIL[1]!;
  const abx = RAIL[2]! - ax;
  const abz = RAIL[3]! - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((e.x - ax) * abx + (e.z - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - e.x;
  const cz = az + abz * t - e.z;
  const r = RAIL[4]! + e.radius;
  return cx * cx + cz * cz <= r * r;
}

function railHitEnemy(w: WorldState, e: EnemyEntity, owner: PlayerIndex): void {
  HIT_IN[0] = RAIL[5]!;
  HIT_IN[1] = RAIL[0]!;
  HIT_IN[2] = RAIL[1]!;
  hitEnemy(w, e, owner, false);
}

/** Railburst: one piercing hit to everything on the rail (enemies, boss parts, versus opponent). */
function fireRail(w: WorldState, p: PlayerEntity, damage: number): void {
  const s = p.special;
  const ax = s.x;
  const az = s.z;
  const bx = ax + s.dirX * SPECIALS.railburst.length;
  const bz = az + s.dirZ * SPECIALS.railburst.length;
  const half = s.radius;
  RAIL[0] = ax;
  RAIL[1] = az;
  RAIL[2] = bx;
  RAIL[3] = bz;
  RAIL[4] = half;
  RAIL[5] = damage;
  const pool = w.enemies;
  for (let i = pool.count - 1; i >= 0; i--) {
    const e = pool.active[i]!;
    if (!e.dying && railTouches(e)) railHitEnemy(w, e, p.index);
  }
  for (let b = 0; b < w.bosses.length; b++) {
    const boss = w.bosses[b]!;
    if (!boss.alive || boss.introTimer > 0) continue;
    const r = half + boss.radius;
    if (pointSegDistSq(boss.x, boss.z, ax, az, bx, bz) <= r * r)
      applyBossDamage(w, boss, damage, p.index, false);
  }
  if (w.mode === 'versus') {
    const q = w.players[p.index === 0 ? 1 : 0];
    const r = half + q.radius;
    if (q.life === 'alive' && pointSegDistSq(q.x, q.z, ax, az, bx, bz) <= r * r) {
      damagePlayer(w, q, damage, p.index, ax, az, 'pvpSpecial');
    }
  }
}

function blink(w: WorldState, p: PlayerEntity, mul: number, it: PlayerIntent | null): void {
  const cfg = SPECIALS.blinkSwarm;
  const s = p.special;
  const ox = p.x;
  const oz = p.z;
  let dx = s.dirX;
  let dz = s.dirZ;
  if (it !== null && (it.moveX !== 0 || it.moveZ !== 0)) {
    const l = Math.sqrt(it.moveX * it.moveX + it.moveZ * it.moveZ);
    dx = it.moveX / l;
    dz = it.moveZ / l;
  }
  let nx = ox + dx * cfg.distance;
  let nz = oz + dz * cfg.distance;
  const lim = ARENA.RADIUS - p.radius;
  const r2 = nx * nx + nz * nz;
  if (r2 > lim * lim) {
    const k = lim / Math.sqrt(r2);
    nx *= k;
    nz *= k;
  }
  p.x = p.prevX = nx;
  p.z = p.prevZ = nz;
  const until = w.time + BLINK_IFRAMES;
  if (until > p.invulnUntil) p.invulnUntil = until;
  SPEC.owner = p.index;
  SPEC.kind = PROJECTILE_KINDS.mine;
  SPEC.vx = 0;
  SPEC.vz = 0;
  SPEC.damage = cfg.mineDamage * mul;
  SPEC.radius = cfg.mineRadius;
  SPEC.life = cfg.mineLife * mul;
  SPEC.pierce = 0;
  SPEC.bounces = 0;
  SPEC.crit = false;
  SPEC.homing = NO_HANDLE;
  const rng = w.rng.sim;
  for (let i = 0; i < cfg.mines; i++) {
    const a = ((i + rng.next()) / cfg.mines) * Math.PI * 2;
    const d = rng.range(0.3, 1) * cfg.scatter;
    SPEC.x = ox + Math.sin(a) * d;
    SPEC.z = oz + Math.cos(a) * d;
    spawnProjectile(w, SPEC);
  }
}

/** Starts the vehicle's special (the meter was already paid, or this is a SUDO repeat). */
export function castSpecial(w: WorldState, p: PlayerEntity, it: PlayerIntent | null): void {
  const kind: SpecialKind = VEHICLES[p.vehicle].special;
  const tier = tierOf(p);
  const mul = specialTierMul(tier);
  const s = p.special;
  s.active = true;
  s.kind = kind;
  s.tier = tier;
  s.x = p.x;
  s.z = p.z;
  s.dirX = p.aimX;
  s.dirZ = p.aimZ;
  s.fireAcc = 0;
  switch (kind) {
    case 'railburst':
      s.duration = SPECIALS.railburst.duration * mul;
      s.radius = (SPECIALS.railburst.width * mul) / 2;
      s.timer = s.duration;
      emitSpecial(w, p);
      fireRail(w, p, SPECIALS.railburst.damage * mul);
      return;
    case 'firewall':
      s.duration = SPECIALS.firewall.duration * mul;
      s.radius = SPECIALS.firewall.radius * mul;
      break;
    case 'blinkSwarm':
      s.duration = BLINK_VISUAL_TIME;
      s.radius = SPECIALS.blinkSwarm.scatter;
      blink(w, p, mul, it);
      break;
    case 'patchDrone':
      s.duration = SPECIALS.patchDrone.duration * mul;
      s.radius = SPECIALS.patchDrone.radius * mul;
      s.x = p.x + Math.sin(w.time * DRONE_ORBIT_SPEED) * SPECIALS.patchDrone.orbit;
      s.z = p.z + Math.cos(w.time * DRONE_ORBIT_SPEED) * SPECIALS.patchDrone.orbit;
      break;
  }
  s.timer = s.duration;
  emitSpecial(w, p);
}

function heal(w: WorldState, target: PlayerEntity, amount: number, emit: boolean): void {
  if (target.life !== 'alive' || target.hp >= target.stats.maxHp) return;
  const before = target.hp;
  target.hp = Math.min(target.stats.maxHp, target.hp + amount);
  if (emit) emitPlayer(w, target.index, 'heal', target.hp - before, target.x, target.z);
}

function stepDrone(w: WorldState, p: PlayerEntity, dt: number, emit: boolean): void {
  const cfg = SPECIALS.patchDrone;
  const s = p.special;
  const mul = specialTierMul(s.tier);
  s.x = p.x + Math.sin(w.time * DRONE_ORBIT_SPEED) * cfg.orbit;
  s.z = p.z + Math.cos(w.time * DRONE_ORBIT_SPEED) * cfg.orbit;
  const r2 = s.radius * s.radius;
  for (let i = 0; i < 2; i++) {
    const t = w.players[i as PlayerIndex];
    if (t !== p && w.mode === 'versus') continue;
    const dx = t.x - s.x;
    const dz = t.z - s.z;
    if (dx * dx + dz * dz <= r2) heal(w, t, cfg.healPerS * dt, emit);
  }
  s.fireAcc += cfg.turretRate * dt;
  if (s.fireAcc < 1) return;
  const target = nearestTarget(w, s.x, s.z, cfg.turretRange);
  if (target === NO_HANDLE) {
    s.fireAcc = 1;
    return;
  }
  s.fireAcc -= 1;
  const dx = NEAREST.x - s.x;
  const dz = NEAREST.z - s.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l < 1e-6) return;
  SPEC.owner = p.index;
  SPEC.kind = PROJECTILE_KINDS.turret;
  SPEC.x = s.x;
  SPEC.z = s.z;
  SPEC.vx = (dx / l) * TURRET_SHOT_SPEED;
  SPEC.vz = (dz / l) * TURRET_SHOT_SPEED;
  SPEC.damage = cfg.turretDamage * mul;
  SPEC.radius = TURRET_SHOT_RADIUS;
  SPEC.life = cfg.turretRange / TURRET_SHOT_SPEED + 0.1;
  SPEC.pierce = 0;
  SPEC.bounces = 0;
  SPEC.crit = false;
  SPEC.homing = target;
  spawnProjectile(w, SPEC);
}

function castLocked(w: WorldState): boolean {
  const ph = w.run.phase;
  return ph === 'clearOutro' || ph === 'roundOutro' || ph === 'done';
}

export const stepSpecials: SimSystem = (w: WorldState, intents: Intents, dt: number): void => {
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    const s = p.special;
    if (p.life !== 'alive') {
      s.active = false;
      s.pendingCasts = 0;
      continue;
    }
    const it = intents[i as PlayerIndex];
    if (s.active) {
      const prevTimer = s.timer;
      s.timer -= dt;
      if (s.kind === 'firewall') {
        s.x = p.x;
        s.z = p.z;
      } else if (s.kind === 'patchDrone') {
        // One heal event per whole second of drone time (the heal itself is continuous).
        stepDrone(w, p, dt, Math.floor(prevTimer) !== Math.floor(s.timer));
      }
      if (s.timer <= TIMER_EPS) {
        s.active = false;
        s.timer = 0;
        if (s.pendingCasts > 0) {
          s.pendingCasts--;
          castSpecial(w, p, null);
        }
      }
      continue;
    }
    if (!it.specialPressed || p.overdrive < OVERDRIVE.MAX || castLocked(w)) continue;
    p.overdrive = 0;
    s.pendingCasts = hasCard(p, CARD_BIT.sudo) ? 1 : 0;
    castSpecial(w, p, it);
  }
};

/** Active Firewall dome of player p (for collision), or false. */
export function firewallActive(p: Readonly<PlayerEntity>): boolean {
  return p.life === 'alive' && p.special.active && p.special.kind === 'firewall';
}
