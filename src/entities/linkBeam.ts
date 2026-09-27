/**
 * Link Beam: joins two living players 4..linkRange u apart (co-op) or the solo player and the orbiting Echo
 * Drone (60% damage). Deals linkDps to every enemy it crosses (damage ticks every 0.1 s, SOURCE_LINK), Leeches
 * latch onto it and cut it until dashed off or killed. No-op in versus.
 */
import type { Intents } from '../contracts/input';
import type { LinkState } from '../contracts/sim';
import { SOURCE_LINK } from '../contracts/simEvents';
import type { SimSystem, WorldState } from '../contracts/world';
import { ENEMY_DEFS } from '../config/enemies';
import { COOP, SIM } from '../config/tuning';
import { HIT_IN, applyBossDamage, hitEnemy } from './damage';

export const LINK_TICK_EVERY = 12;
const LINK_TICK_S = LINK_TICK_EVERY * SIM.DT;
const LATCH_RANGE = ENEMY_DEFS.leech.params.latchRange;
/** A latched Leech farther than this from the beam falls off. */
const UNLATCH_RANGE = LATCH_RANGE * 1.5;

const CLOSEST = { x: 0, z: 0, d2: 0 };

/**
 * Closest point on the link segment A-B to p (written to CLOSEST). Takes the entity and the link rather than
 * their coordinates: doubles passed to a call that is not inlined are boxed (six per enemy per step).
 */
function closestOnLink(p: Readonly<{ x: number; z: number }>, link: Readonly<LinkState>): void {
  const px = p.x;
  const pz = p.z;
  const ax = link.ax;
  const az = link.az;
  const bx = link.bx;
  const bz = link.bz;
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  CLOSEST.x = ax + abx * t;
  CLOSEST.z = az + abz * t;
  const dx = px - CLOSEST.x;
  const dz = pz - CLOSEST.z;
  CLOSEST.d2 = dx * dx + dz * dz;
}

function unlatchAll(w: WorldState): void {
  const pool = w.enemies;
  for (let i = 0; i < pool.count; i++) pool.active[i]!.latched = 0;
  w.link.latchedCount = 0;
  w.link.cut = false;
}

function deactivate(w: WorldState): void {
  const link = w.link;
  if (link.latchedCount > 0) unlatchAll(w);
  link.active = false;
  link.cut = false;
  link.length = 0;
}

/** Sets the beam endpoints; returns false when there is no beam this tick. */
function placeBeam(w: WorldState, dt: number): boolean {
  const link = w.link;
  const a = w.players[0];
  if (w.mode === 'solo') {
    link.droneAngle += COOP.ECHO_ORBIT_SPEED * dt;
    if (link.droneAngle > Math.PI * 2) link.droneAngle -= Math.PI * 2;
    link.droneX = a.x + Math.sin(link.droneAngle) * COOP.ECHO_ORBIT;
    link.droneZ = a.z + Math.cos(link.droneAngle) * COOP.ECHO_ORBIT;
    link.droneActive = a.life === 'alive';
    if (!link.droneActive) return false;
    link.ax = a.x;
    link.az = a.z;
    link.bx = link.droneX;
    link.bz = link.droneZ;
    link.length = COOP.ECHO_ORBIT;
    return true;
  }
  link.droneActive = false;
  const b = w.players[1];
  if (a.life !== 'alive' || b.life !== 'alive') return false;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const range = a.stats.linkRange > b.stats.linkRange ? a.stats.linkRange : b.stats.linkRange;
  if (d < COOP.LINK_MIN || d > range) return false;
  link.ax = a.x;
  link.az = a.z;
  link.bx = b.x;
  link.bz = b.z;
  link.length = d;
  return true;
}

function updateLatches(w: WorldState): void {
  const link = w.link;
  const pool = w.enemies;
  let n = 0;
  for (let i = 0; i < pool.count; i++) {
    const e = pool.active[i]!;
    if (e.kind !== 'leech') continue;
    if (e.dying) {
      e.latched = 0;
      continue;
    }
    closestOnLink(e, link);
    const reach = e.latched !== 0 ? UNLATCH_RANGE : LATCH_RANGE;
    const r = reach + e.radius;
    e.latched = CLOSEST.d2 <= r * r ? 1 : 0;
    n += e.latched;
  }
  link.latchedCount = n;
  link.cut = n > 0;
}

function beamDamage(w: WorldState): void {
  const link = w.link;
  const a = w.players[0];
  const b = w.players[1];
  let dps = a.stats.linkDps;
  if (w.mode === 'solo') dps *= COOP.ECHO_DAMAGE_MUL;
  else if (b.stats.linkDps > dps) dps = b.stats.linkDps;
  const dmg = dps * LINK_TICK_S;
  const half = COOP.LINK_WIDTH / 2;
  const pool = w.enemies;
  for (let i = pool.count - 1; i >= 0; i--) {
    const e = pool.active[i]!;
    if (e.dying) continue;
    closestOnLink(e, link);
    const r = half + e.radius;
    if (CLOSEST.d2 > r * r) continue;
    // applyDamage(w, e, dmg, SOURCE_LINK, CLOSEST.x, CLOSEST.z, false) through HIT_IN (no boxed arguments).
    HIT_IN[0] = dmg;
    HIT_IN[1] = CLOSEST.x;
    HIT_IN[2] = CLOSEST.z;
    hitEnemy(w, e, SOURCE_LINK, false);
  }
  for (let k = 0; k < w.bosses.length; k++) {
    const boss = w.bosses[k]!;
    if (!boss.alive || boss.introTimer > 0) continue;
    closestOnLink(boss, link);
    const r = half + boss.radius;
    if (CLOSEST.d2 <= r * r) applyBossDamage(w, boss, dmg, SOURCE_LINK, false);
  }
}

export const stepLinkBeam: SimSystem = (w: WorldState, _intents: Intents, dt: number): void => {
  const link = w.link;
  if (w.mode === 'versus') {
    link.active = false;
    link.droneActive = false;
    return;
  }
  if (!placeBeam(w, dt)) {
    deactivate(w);
    return;
  }
  link.active = true;
  updateLatches(w);
  if (!link.cut && w.tick % LINK_TICK_EVERY === 0) beamDamage(w);
};
