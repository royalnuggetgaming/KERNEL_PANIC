/**
 * Primary weapons: cadence accumulator (several shots per tick when needed), twin/spread/needle/arc volleys,
 * focus (tighter spread, +15% damage), crits, split shot, pierce, ricochet, FORK() and Overheat (+40% fire
 * rate at runtime; any excess above the 20/s cap becomes a damage multiplier).
 */
import { NO_HANDLE, type PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import {
  PROJECTILE_KINDS,
  type PlayerEntity,
  type ProjectileKind,
  type ProjectileSpec,
} from '../contracts/sim';
import type { SimSystem, WorldState } from '../contracts/world';
import { DEG2RAD } from '../core/math';
import { CARD_PARAMS } from '../config/cards';
import { MOVEMENT, STAT_CAPS } from '../config/tuning';
import { VEHICLES, type WeaponKind } from '../config/vehicles';
import { CARD_BIT, cardStacks } from './cardBits';
import { spawnProjectile } from './projectiles';

/** Angular offset between the two copies of a FORK() doubled volley. */
const FORK_OFFSET = 3 * DEG2RAD;
const ACC_EPS = 1e-9;
/** Per-volley base damage before the crit roll (module scratch). */
const SPEC_BASE = { damage: 0 };

const SPEC: ProjectileSpec = {
  side: 'player',
  owner: 0,
  kind: PROJECTILE_KINDS.bolt,
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

export function projectileKindFor(kind: WeaponKind): ProjectileKind {
  switch (kind) {
    case 'twin':
      return PROJECTILE_KINDS.bolt;
    case 'spread':
      return PROJECTILE_KINDS.pellet;
    case 'needle':
      return PROJECTILE_KINDS.needle;
    case 'arc':
      return PROJECTILE_KINDS.arc;
  }
}

/** Runtime cadence: returns the effective fire rate and writes the overflow damage factor into RATE.mul. */
export const RATE = { rate: 0, mul: 1 };

export function effectiveFireRate(p: Readonly<PlayerEntity>): void {
  let rate = p.stats.fireRate;
  if (p.cards.overheatActive) rate *= 1 + CARD_PARAMS.overheat.fireRateBonus;
  RATE.mul = 1;
  if (rate > STAT_CAPS.fireRateMax) {
    RATE.mul = rate / STAT_CAPS.fireRateMax;
    rate = STAT_CAPS.fireRateMax;
  }
  RATE.rate = rate;
}

function intStat(v: number, min: number, max: number): number {
  const r = Math.round(v);
  return r < min ? min : r > max ? max : r;
}

function emitShot(w: WorldState, p: PlayerEntity, x: number, z: number, dx: number, dz: number): void {
  const e = w.events.shot.push();
  e.owner = p.index;
  e.vehicle = p.vehicle;
  e.x = x;
  e.z = z;
  e.dirX = dx;
  e.dirZ = dz;
}

function fireOne(w: WorldState, p: PlayerEntity, yaw: number, lateral: number, lead: number): void {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const speed = p.stats.projectileSpeed;
  const muzzle = p.radius * 0.8;
  // Perpendicular (right-hand) offset for twin barrels.
  SPEC.x = p.x + dx * (muzzle + speed * lead) + dz * lateral;
  SPEC.z = p.z + dz * (muzzle + speed * lead) - dx * lateral;
  SPEC.vx = dx * speed;
  SPEC.vz = dz * speed;
  let dmg = SPEC_BASE.damage;
  let crit = false;
  if (p.stats.critChance > 0 && w.rng.sim.chance(p.stats.critChance)) {
    dmg *= STAT_CAPS.critMul;
    crit = true;
  }
  SPEC.damage = dmg;
  SPEC.crit = crit;
  spawnProjectile(w, SPEC);
}

/** One volley along the player's aim direction. */
function fireVolley(w: WorldState, p: PlayerEntity, focus: boolean, dmgMul: number, lead: number): void {
  const weapon = VEHICLES[p.vehicle].weapon;
  const baseYaw = Math.atan2(p.aimX, p.aimZ);
  const n = intStat(p.stats.projectiles, 1, STAT_CAPS.projectilesMax);
  let sidePairs = cardStacks(p, CARD_BIT.splitShot);
  const room = Math.floor((STAT_CAPS.projectilesMax - n) / 2);
  if (sidePairs > room) sidePairs = room;
  const spreadDeg = p.stats.spreadDeg * (focus ? MOVEMENT.FOCUS_SPREAD_MUL : 1);
  SPEC.owner = p.index;
  SPEC.kind = projectileKindFor(weapon.kind);
  SPEC.radius = weapon.radius;
  SPEC.life = weapon.life;
  SPEC.pierce = intStat(p.stats.pierce, 0, STAT_CAPS.pierceMax);
  SPEC.bounces = intStat(p.stats.bounces, 0, STAT_CAPS.bouncesMax);
  SPEC.homing = NO_HANDLE;
  SPEC_BASE.damage = weapon.damage * dmgMul * (focus ? 1 + MOVEMENT.FOCUS_DAMAGE_BONUS : 1);
  const counter = ++p.cards.forkShotCounter;
  const lateral = weapon.muzzleOffset * ((counter & 1) === 0 ? 1 : -1);
  const doubled = cardStacks(p, CARD_BIT.forkCall) > 0 && counter % CARD_PARAMS.forkCall.every === 0;
  const copies = doubled ? 2 : 1;
  for (let c = 0; c < copies; c++) {
    const yaw0 = baseYaw + (doubled ? (c === 0 ? -FORK_OFFSET : FORK_OFFSET) : 0);
    for (let k = 0; k < n; k++) {
      let yaw = yaw0;
      if (n === 1) {
        if (spreadDeg > 0) yaw += w.rng.sim.range(-0.5, 0.5) * spreadDeg * DEG2RAD;
      } else {
        yaw += (k - (n - 1) / 2) * spreadDeg * DEG2RAD;
      }
      fireOne(w, p, yaw, lateral, lead);
    }
    for (let s = 1; s <= sidePairs; s++) {
      const off = CARD_PARAMS.splitShot.angleDeg * s * DEG2RAD;
      fireOne(w, p, yaw0 - off, 0, lead);
      fireOne(w, p, yaw0 + off, 0, lead);
    }
  }
  emitShot(w, p, p.x, p.z, p.aimX, p.aimZ);
}

function weaponsLocked(w: WorldState): boolean {
  const ph = w.run.phase;
  return ph === 'clearOutro' || ph === 'roundOutro' || ph === 'done';
}

export const stepWeapons: SimSystem = (w: WorldState, intents: Intents, dt: number): void => {
  const locked = weaponsLocked(w);
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    if (p.life !== 'alive') {
      p.fireAcc = 0;
      continue;
    }
    effectiveFireRate(p);
    const rate = RATE.rate;
    const it = intents[i as PlayerIndex];
    if (locked || !it.fireHeld || rate <= 0) {
      // Idle barrels stay primed: the next press fires immediately.
      const acc = p.fireAcc + rate * dt;
      p.fireAcc = acc > 1 ? 1 : acc;
      continue;
    }
    p.fireAcc += rate * dt;
    const dmgMul = p.stats.damageMul * RATE.mul;
    while (p.fireAcc >= 1 - ACC_EPS) {
      p.fireAcc -= 1;
      const lead = p.fireAcc > 0 ? p.fireAcc / rate : 0;
      fireVolley(w, p, it.focusHeld, dmgMul, lead);
    }
  }
};
