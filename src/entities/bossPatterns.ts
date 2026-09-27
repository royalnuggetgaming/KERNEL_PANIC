/**
 * Data-driven boss attack primitives (config/bosses.ts AttackStep): ring, spiral, aimed volley, sweep beam,
 * firewall arc segments, charge, summon and wait. Each step keeps its progress in the boss record
 * (patternTimer = seconds into the step, stepCount = emissions so far, aimAngle = spiral/charge heading).
 *
 * Laser convention: LaserEntity.angle is a yaw (math.ts: direction = (sin(angle), cos(angle))), anchored at
 * (x, z). Sweep beams (shape 0) extend `length` along that direction; firewall segments (shape 1) are arcs of
 * `radius` centred on `angle` with half-angle `arcHalf`. Lasers deal `damage` per second once warmup reaches 0.
 */
import { PROJECTILE_KINDS, type BossEntity } from '../contracts/sim';
import { SOURCE_WORLD } from '../contracts/simEvents';
import type { WorldState } from '../contracts/world';
import type { AttackStep } from '../config/bosses';
import { DEG2RAD, TAU } from '../core/math';
import {
  BOSS_SHOT_RADIUS,
  emitEnemyShot,
  emitSpawn,
  emitTelegraph,
  fireEnemyShot,
  nearestTarget,
} from './contentShared';
import { damagePlayer } from './damage';
import { spawnEnemy } from './enemies';

/** Per-emission bullet budget (a ring or volley never exceeds this many bullets). */
export const MAX_BULLETS_PER_EMISSION = 48;
/** Summoned adds appear this far outside the boss radius. */
const SUMMON_GAP = 2.5;
/** Charge contact reach beyond the two radii. */
const CHARGE_REACH = 0.2;

/** Heading (yaw) from the boss to its nearest targetable player; straight down-screen (+Z) when none. */
export function aimAtTarget(w: WorldState, b: BossEntity): number {
  const t = nearestTarget(w, b.x, b.z);
  if (t === -1) return 0;
  const p = w.players[t];
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  if (dx * dx + dz * dz < 1e-9) return 0;
  return Math.atan2(dx, dz);
}

/** Twin parts rotate their patterns in opposite directions (Race Condition counter-rotation). */
function spinSign(b: BossEntity): number {
  return (b.part & 1) === 0 ? 1 : -1;
}

function fireFan(
  w: WorldState,
  b: BossEntity,
  count: number,
  centre: number,
  spread: number,
  speed: number,
  damage: number,
): void {
  const n = count > MAX_BULLETS_PER_EMISSION ? MAX_BULLETS_PER_EMISSION : count;
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? centre : centre + (i / (n - 1) - 0.5) * spread;
    fireEnemyShot(w, PROJECTILE_KINDS.bossOrb, b.x, b.z, a, speed, damage, BOSS_SHOT_RADIUS);
  }
  emitEnemyShot(w, b.x, b.z, true);
}

function fireRing(
  w: WorldState,
  b: BossEntity,
  count: number,
  offset: number,
  speed: number,
  damage: number,
): void {
  const n = count > MAX_BULLETS_PER_EMISSION ? MAX_BULLETS_PER_EMISSION : count;
  for (let i = 0; i < n; i++) {
    fireEnemyShot(
      w,
      PROJECTILE_KINDS.bossOrb,
      b.x,
      b.z,
      offset + (i * TAU) / n,
      speed,
      damage,
      BOSS_SHOT_RADIUS,
    );
  }
  emitEnemyShot(w, b.x, b.z, true);
}

function spawnLaser(
  w: WorldState,
  shape: 0 | 1,
  x: number,
  z: number,
  angle: number,
  angularVel: number,
  length: number,
  width: number,
  radius: number,
  arcHalf: number,
  warmup: number,
  life: number,
  damage: number,
): boolean {
  const l = w.lasers.spawn();
  if (l === null) return false;
  l.shape = shape;
  l.x = x;
  l.z = z;
  l.angle = angle;
  l.angularVel = angularVel;
  l.length = length;
  l.width = width;
  l.radius = radius;
  l.arcHalf = arcHalf;
  l.warmup = warmup;
  l.life = life;
  l.damage = damage;
  return true;
}

/** Advances boss lasers: warmup, rotation, lifetime. Called once per tick by stepBoss. */
export function stepLasers(w: WorldState, dt: number): void {
  const pool = w.lasers;
  for (let i = pool.count - 1; i >= 0; i--) {
    const l = pool.active[i]!;
    l.warmup = l.warmup > dt ? l.warmup - dt : 0;
    l.angle += l.angularVel * dt;
    l.life -= dt;
    if (l.life <= 0) pool.despawn(l);
  }
}

function chargeContact(w: WorldState, b: BossEntity, damage: number): void {
  for (let pi = 0; pi < 2; pi++) {
    const p = w.players[pi === 0 ? 0 : 1];
    const bit = 2 << pi;
    if ((b.stepCount & bit) !== 0 || p.life !== 'alive') continue;
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const reach = p.radius + b.radius + CHARGE_REACH;
    if (dx * dx + dz * dz > reach * reach) continue;
    b.stepCount |= bit;
    damagePlayer(w, p, damage, SOURCE_WORLD, b.x, b.z, 'contact');
  }
}

/**
 * Advances one attack step for a boss part; returns true when the step finished. Writes enemy shots, lasers,
 * telegraphs. Charge, sweep and firewall steps also own the boss velocity while they run.
 */
export function runPattern(w: WorldState, b: BossEntity, step: AttackStep, dt: number): boolean {
  b.patternTimer += dt;
  const t = b.patternTimer;
  switch (step.prim) {
    case 'ring': {
      while (b.stepCount < step.repeats && t >= b.stepCount * step.interval) {
        const offset = b.aimAngle + ((b.stepCount & 1) * Math.PI) / step.bullets;
        fireRing(w, b, step.bullets, offset, step.speed, step.damage);
        b.stepCount++;
      }
      return b.stepCount >= step.repeats && t >= step.repeats * step.interval;
    }
    case 'spiral': {
      b.aimAngle += step.turnDegPerS * DEG2RAD * spinSign(b) * dt;
      const total = Math.ceil(step.duration * step.rate);
      const due = Math.min(total, Math.floor(t * step.rate) + 1);
      while (b.stepCount < due) {
        fireRing(w, b, step.arms, b.aimAngle, step.speed, step.damage);
        b.stepCount++;
      }
      return t >= step.duration;
    }
    case 'aimed': {
      while (b.stepCount < step.volleys && t >= b.stepCount * step.interval) {
        fireFan(w, b, step.shots, aimAtTarget(w, b), step.spreadDeg * DEG2RAD, step.speed, step.damage);
        b.stepCount++;
      }
      return b.stepCount >= step.volleys && t >= step.volleys * step.interval;
    }
    case 'sweep': {
      b.vx = 0;
      b.vz = 0;
      if (b.stepCount === 0) {
        b.stepCount = 1;
        const aim = aimAtTarget(w, b);
        const vel = step.turnDegPerS * DEG2RAD * spinSign(b);
        for (let k = 0; k < step.beams; k++) {
          const a = aim + (k * TAU) / step.beams;
          const life = step.warmup + step.duration;
          if (
            !spawnLaser(
              w,
              0,
              b.x,
              b.z,
              a,
              vel,
              step.length,
              step.width,
              0,
              0,
              step.warmup,
              life,
              step.damagePerS,
            )
          )
            break;
          emitTelegraph(w, 1, b.x, b.z, Math.sin(a), Math.cos(a), step.length, step.warmup);
        }
      }
      return t >= step.warmup + step.duration;
    }
    case 'firewall': {
      b.vx = 0;
      b.vz = 0;
      if (b.stepCount === 0) {
        b.stepCount = 1;
        const vel = step.turnDegPerS * DEG2RAD * spinSign(b);
        const half = step.arcDeg * 0.5 * DEG2RAD;
        const life = step.warmup + step.duration;
        for (let k = 0; k < step.segments; k++) {
          const a = (k * TAU) / step.segments;
          if (
            !spawnLaser(
              w,
              1,
              b.x,
              b.z,
              a,
              vel,
              0,
              step.width,
              step.radius,
              half,
              step.warmup,
              life,
              step.damagePerS,
            )
          )
            break;
        }
        emitTelegraph(w, 0, b.x, b.z, 0, 1, step.radius, step.warmup);
      }
      return t >= step.warmup + step.duration;
    }
    case 'charge': {
      if (b.stepCount === 0) {
        b.stepCount = 1;
        b.aimAngle = aimAtTarget(w, b);
        emitTelegraph(
          w,
          1,
          b.x,
          b.z,
          Math.sin(b.aimAngle),
          Math.cos(b.aimAngle),
          step.speed * step.duration,
          step.telegraph,
        );
      }
      if (t < step.telegraph || t >= step.telegraph + step.duration) {
        b.vx = 0;
        b.vz = 0;
      } else {
        b.vx = Math.sin(b.aimAngle) * step.speed;
        b.vz = Math.cos(b.aimAngle) * step.speed;
        b.yaw = b.aimAngle;
        chargeContact(w, b, step.damage);
      }
      return t >= step.telegraph + step.duration;
    }
    case 'summon': {
      const dist = b.radius + SUMMON_GAP;
      for (let k = 0; k < step.count; k++) {
        const a = b.aimAngle + (k * TAU) / step.count;
        const e = spawnEnemy(w, step.kind, b.x + Math.sin(a) * dist, b.z + Math.cos(a) * dist, step.elite, 0);
        if (e === null) break;
        emitSpawn(w, e.kind, e.x, e.z, e.elite);
        emitTelegraph(w, 0, e.x, e.z, 0, 1, e.radius * 2, 0.3);
      }
      return true;
    }
    case 'wait':
      return t >= step.duration;
  }
}
