/**
 * Per-tick card behaviours (ownership-gated through cardStacks): Orbitals, Micro-Missiles, Afterimage trail,
 * Vampire Code heal, Nanoshield recharge and the Overheat flag. Chain Arc (and the Tinker arc pistol chain) run
 * on hit through arcChain(), called by sim/collision.ts. Card effects target enemies only (never PvP).
 */
import { NO_HANDLE, type PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import {
  PROJECTILE_KINDS,
  TRAIL_POINTS,
  type EnemyEntity,
  type PlayerEntity,
  type ProjectileEntity,
  type ProjectileSpec,
} from '../contracts/sim';
import type { SimSystem, WorldState } from '../contracts/world';
import { CARD_PARAMS } from '../config/cards';
import { SIM } from '../config/tuning';
import { CARD_BIT, cardStacks, hasCard } from './cardBits';
import { HIT_IN, applyBossDamage, applyDamage, hitEnemy } from './damage';
import { nearestTarget, spawnProjectile } from './projectiles';
import { emitPlayer } from './simEventsOut';

/** Area card effects deal damage every N ticks (0.1 s) instead of every tick. */
export const DAMAGE_TICK_EVERY = 12;
const DAMAGE_TICK_S = DAMAGE_TICK_EVERY * SIM.DT;
export const MISSILE_RADIUS = 0.25;
/** Micro-Missiles launch this far off the aim direction (alternating sides). */
const MISSILE_SPLAY = 0.9;

const SPEC: ProjectileSpec = {
  side: 'player',
  owner: 0,
  kind: PROJECTILE_KINDS.missile,
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  damage: 0,
  radius: MISSILE_RADIUS,
  life: 0,
  pierce: 0,
  bounces: 0,
  crit: false,
  homing: NO_HANDLE,
};

const PICKED = new Int32Array(8);
/** Arc origin and per-hop damage: [x, z, damage] (scratch, so the per-hit path passes no boxed doubles). */
const ARC = new Float64Array(3);

/** arcChain from ARC: nearest-unhit-enemy hops, each emitting an arc event and dealing ARC[2]. */
function runArc(
  w: WorldState,
  owner: PlayerIndex,
  count: number,
  range: number,
  excludeSlot: number,
): number {
  let hops = 0;
  const max = count < PICKED.length ? count : PICKED.length;
  const pool = w.enemies;
  const r2 = range * range;
  for (let h = 0; h < max; h++) {
    let best = -1;
    let bestD = r2;
    const fx = ARC[0]!;
    const fz = ARC[1]!;
    for (let i = 0; i < pool.count; i++) {
      const e = pool.active[i]!;
      if (e.dying || e.slot === excludeSlot) continue;
      let used = false;
      for (let k = 0; k < hops; k++) if (PICKED[k] === e.slot) used = true;
      if (used) continue;
      const dx = e.x - fx;
      const dz = e.z - fz;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) break;
    const e = pool.active[best]!;
    PICKED[hops++] = e.slot;
    const a = w.events.arc.push();
    a.x0 = fx;
    a.z0 = fz;
    a.x1 = e.x;
    a.z1 = e.z;
    a.owner = owner;
    HIT_IN[0] = ARC[2]!;
    HIT_IN[1] = fx;
    HIT_IN[2] = fz;
    hitEnemy(w, e, owner, false);
    ARC[0] = e.x;
    ARC[1] = e.z;
  }
  return hops;
}

/**
 * Arcs from (x, z) to up to `count` enemies (each hop picks the nearest unhit enemy within `range` of the
 * previous point), dealing `damage` each. excludeSlot (the enemy already hit) is skipped. Returns hops made.
 */
export function arcChain(
  w: WorldState,
  owner: PlayerIndex,
  x: number,
  z: number,
  damage: number,
  count: number,
  range: number,
  excludeSlot: number,
): number {
  ARC[0] = x;
  ARC[1] = z;
  ARC[2] = damage;
  return runArc(w, owner, count, range, excludeSlot);
}

/** arcChain starting at the enemy `from` just struck by shot s (Tinker arc pistol), dealing s.damage per hop. */
export function arcChainFromShot(
  w: WorldState,
  owner: PlayerIndex,
  from: Readonly<EnemyEntity>,
  s: Readonly<ProjectileEntity>,
  count: number,
  range: number,
): number {
  ARC[0] = from.x;
  ARC[1] = from.z;
  ARC[2] = s.damage;
  return runArc(w, owner, count, range, from.slot);
}

function chainArcRoll(w: WorldState, owner: PlayerIndex): boolean {
  return hasCard(w.players[owner], CARD_BIT.chainArc) && w.rng.sim.chance(CARD_PARAMS.chainArc.chance);
}

/** Chain Arc card: 15% chance on a weapon hit to arc to 3 enemies for 50% damage. */
export function chainArcOnHit(
  w: WorldState,
  owner: PlayerIndex,
  x: number,
  z: number,
  hitDamage: number,
  excludeSlot: number,
): void {
  if (!chainArcRoll(w, owner)) return;
  const c = CARD_PARAMS.chainArc;
  arcChain(w, owner, x, z, hitDamage * c.damageMul, c.targets, c.range, excludeSlot);
}

/** chainArcOnHit for shot s striking enemy `from` (no boxed double arguments on the per-hit path). */
export function chainArcFromShot(
  w: WorldState,
  owner: PlayerIndex,
  from: Readonly<EnemyEntity>,
  s: Readonly<ProjectileEntity>,
): void {
  if (!chainArcRoll(w, owner)) return;
  const c = CARD_PARAMS.chainArc;
  ARC[0] = from.x;
  ARC[1] = from.z;
  ARC[2] = s.damage * c.damageMul;
  runArc(w, owner, c.targets, c.range, from.slot);
}

/** Damages every enemy / boss part touching the circle (cx, cz, r) once. */
function areaDamage(w: WorldState, owner: PlayerIndex, cx: number, cz: number, r: number, dmg: number): void {
  const pool = w.enemies;
  for (let i = pool.count - 1; i >= 0; i--) {
    const e = pool.active[i]!;
    if (e.dying) continue;
    const rr = r + e.radius;
    const dx = e.x - cx;
    const dz = e.z - cz;
    if (dx * dx + dz * dz <= rr * rr) applyDamage(w, e, dmg, owner, cx, cz, false);
  }
  for (let b = 0; b < w.bosses.length; b++) {
    const boss = w.bosses[b]!;
    if (!boss.alive || boss.introTimer > 0) continue;
    const rr = r + boss.radius;
    const dx = boss.x - cx;
    const dz = boss.z - cz;
    if (dx * dx + dz * dz <= rr * rr) applyBossDamage(w, boss, dmg, owner, false);
  }
}

function stepOrbitals(w: WorldState, p: PlayerEntity, dt: number, damageTick: boolean): void {
  const c = CARD_PARAMS.orbitals;
  const cr = p.cards;
  cr.orbitAngle += c.angularSpeed * dt;
  if (cr.orbitAngle > Math.PI * 2) cr.orbitAngle -= Math.PI * 2;
  if (!damageTick) return;
  for (let k = 0; k < c.blades; k++) {
    const a = cr.orbitAngle + (k * Math.PI * 2) / c.blades;
    areaDamage(
      w,
      p.index,
      p.x + Math.sin(a) * c.radius,
      p.z + Math.cos(a) * c.radius,
      c.bladeRadius,
      c.dps * DAMAGE_TICK_S,
    );
  }
}

function stepMissiles(w: WorldState, p: PlayerEntity, dt: number): void {
  const c = CARD_PARAMS.microMissiles;
  const cr = p.cards;
  cr.missileTimer += dt;
  if (cr.missileTimer < c.interval) return;
  const first = nearestTarget(w, p.x, p.z, 1e4);
  if (first === NO_HANDLE) {
    cr.missileTimer = c.interval;
    return;
  }
  cr.missileTimer -= c.interval;
  const n = c.count * cardStacks(p, CARD_BIT.microMissiles);
  const base = Math.atan2(p.aimX, p.aimZ);
  SPEC.owner = p.index;
  SPEC.damage = c.damage;
  SPEC.life = c.life;
  SPEC.homing = first;
  for (let k = 0; k < n; k++) {
    const side = (k & 1) === 0 ? -1 : 1;
    const a = base + side * MISSILE_SPLAY * (1 + (k >> 1) * 0.3);
    SPEC.x = p.x;
    SPEC.z = p.z;
    SPEC.vx = Math.sin(a) * c.speed;
    SPEC.vz = Math.cos(a) * c.speed;
    spawnProjectile(w, SPEC);
  }
}

function stepAfterimage(w: WorldState, p: PlayerEntity, dt: number, damageTick: boolean): void {
  const c = CARD_PARAMS.afterimage;
  const cr = p.cards;
  if (p.dashTimer > 0) {
    cr.trailTimer -= dt;
    if (cr.trailTimer <= 0) {
      cr.trailTimer = c.sampleEvery;
      const o = cr.trailHead * 3;
      cr.trail[o] = p.x;
      cr.trail[o + 1] = p.z;
      cr.trail[o + 2] = w.time;
      cr.trailHead = (cr.trailHead + 1) % TRAIL_POINTS;
      if (cr.trailCount < TRAIL_POINTS) cr.trailCount++;
    }
  } else {
    cr.trailTimer = 0;
  }
  // Drop expired points from the tail.
  while (cr.trailCount > 0) {
    const tail = (cr.trailHead - cr.trailCount + TRAIL_POINTS) % TRAIL_POINTS;
    if (w.time - cr.trail[tail * 3 + 2]! < c.trailTime) break;
    cr.trailCount--;
  }
  if (!damageTick || cr.trailCount === 0) return;
  const dmg = c.dps * DAMAGE_TICK_S;
  const pool = w.enemies;
  for (let i = pool.count - 1; i >= 0; i--) {
    const e = pool.active[i]!;
    if (e.dying) continue;
    const rr = c.radius + e.radius;
    for (let k = 0; k < cr.trailCount; k++) {
      const o = ((cr.trailHead - 1 - k + TRAIL_POINTS) % TRAIL_POINTS) * 3;
      const dx = e.x - cr.trail[o]!;
      const dz = e.z - cr.trail[o + 1]!;
      if (dx * dx + dz * dz <= rr * rr) {
        applyDamage(w, e, dmg, p.index, cr.trail[o]!, cr.trail[o + 1]!, false);
        break;
      }
    }
  }
}

function stepVampire(w: WorldState, p: PlayerEntity): void {
  const per = CARD_PARAMS.vampireCode.killsPerHp;
  const cr = p.cards;
  if (cr.vampireKills < per) return;
  const stacks = cardStacks(p, CARD_BIT.vampireCode);
  let healed = 0;
  while (cr.vampireKills >= per) {
    cr.vampireKills -= per;
    healed += stacks;
  }
  const before = p.hp;
  p.hp = Math.min(p.stats.maxHp, p.hp + healed);
  if (p.hp > before) emitPlayer(w, p.index, 'heal', p.hp - before, p.x, p.z);
}

function stepNanoshield(p: PlayerEntity, dt: number): void {
  const cr = p.cards;
  if (cr.nanoshieldReady) return;
  cr.nanoshieldTimer += dt;
  if (cr.nanoshieldTimer >= CARD_PARAMS.nanoshield.interval) {
    cr.nanoshieldTimer = 0;
    cr.nanoshieldReady = true;
  }
}

export const stepCardEffects: SimSystem = (w: WorldState, _intents: Intents, dt: number): void => {
  const damageTick = w.tick % DAMAGE_TICK_EVERY === 0;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    const cr = p.cards;
    if (p.life !== 'alive') {
      cr.overheatActive = false;
      continue;
    }
    cr.overheatActive = hasCard(p, CARD_BIT.overheat) && p.hp < p.stats.maxHp * CARD_PARAMS.overheat.hpFrac;
    if (hasCard(p, CARD_BIT.nanoshield)) stepNanoshield(p, dt);
    if (hasCard(p, CARD_BIT.orbitals)) stepOrbitals(w, p, dt, damageTick);
    if (hasCard(p, CARD_BIT.microMissiles)) stepMissiles(w, p, dt);
    if (hasCard(p, CARD_BIT.afterimage)) stepAfterimage(w, p, dt, damageTick);
    if (hasCard(p, CARD_BIT.vampireCode)) stepVampire(w, p);
  }
};
