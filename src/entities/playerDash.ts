/**
 * Dash side effects (Bulwark ram, Leech shedding) and positional clamps used by players.ts.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { PlayerEntity } from '../contracts/sim';
import type { WorldState } from '../contracts/world';
import { ENEMY_DEFS } from '../config/enemies';
import { VEHICLES } from '../config/vehicles';
import { ARENA, CAMERA, CAPACITY } from '../config/tuning';
import { applyBossDamage, applyDamage } from './damage';

/** Distance a shed Leech is thrown off the beam (beyond its latch range). */
export const LEECH_SHED_DISTANCE = ENEMY_DEFS.leech.params.latchRange + 1.5;

const STRIDE = CAPACITY.enemies + CAPACITY.bossParts;

/** Per-world ram bookkeeping: [dash stamp p0, p1, hit stamps p0 (enemies + bosses), hit stamps p1]. */
const ramState = new WeakMap<WorldState, Int32Array>();

function ramOf(w: WorldState): Int32Array {
  let s = ramState.get(w);
  if (s === undefined) {
    s = new Int32Array(2 + 2 * STRIDE);
    ramState.set(w, s);
  }
  return s;
}

/** Starts a new ram window for p (each enemy/boss part is rammed at most once per dash). */
export function beginRam(w: WorldState, p: PlayerIndex): void {
  const s = ramOf(w);
  s[p] = w.tick + 1;
}

/** Bulwark ram: RAM damage to every enemy/boss part the dashing craft overlaps, once per dash. */
export function stepRam(w: WorldState, p: PlayerEntity): void {
  const dmg = VEHICLES[p.vehicle].ramDamage;
  if (dmg <= 0) return;
  const s = ramOf(w);
  const stamp = s[p.index]!;
  const base = 2 + p.index * STRIDE;
  const pool = w.enemies;
  for (let i = pool.count - 1; i >= 0; i--) {
    const e = pool.active[i]!;
    if (e.dying || s[base + e.slot] === stamp) continue;
    const r = e.radius + p.radius;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    if (dx * dx + dz * dz > r * r) continue;
    s[base + e.slot] = stamp;
    applyDamage(w, e, dmg * p.stats.damageMul, p.index, p.x, p.z, false);
  }
  for (let b = 0; b < w.bosses.length; b++) {
    const boss = w.bosses[b]!;
    if (!boss.alive || boss.introTimer > 0) continue;
    const k = base + CAPACITY.enemies + b;
    if (s[k] === stamp) continue;
    const r = boss.radius + p.radius;
    const dx = boss.x - p.x;
    const dz = boss.z - p.z;
    if (dx * dx + dz * dz > r * r) continue;
    s[k] = stamp;
    applyBossDamage(w, boss, dmg * p.stats.damageMul, p.index, false);
  }
}

/** Dashing sheds latched Leeches: they unlatch and are thrown off the beam. */
export function shedLeeches(w: WorldState): void {
  const link = w.link;
  if (link.latchedCount <= 0) return;
  const pool = w.enemies;
  const abx = link.bx - link.ax;
  const abz = link.bz - link.az;
  const l2 = abx * abx + abz * abz;
  for (let i = 0; i < pool.count; i++) {
    const e = pool.active[i]!;
    if (e.latched === 0) continue;
    e.latched = 0;
    let t = l2 > 0 ? ((e.x - link.ax) * abx + (e.z - link.az) * abz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let nx = e.x - (link.ax + abx * t);
    let nz = e.z - (link.az + abz * t);
    let nl = Math.sqrt(nx * nx + nz * nz);
    if (nl < 1e-6) {
      // Exactly on the beam: throw perpendicular to it.
      const bl = Math.sqrt(l2);
      nx = bl > 0 ? -abz / bl : 1;
      nz = bl > 0 ? abx / bl : 0;
      nl = 1;
    }
    e.x += (nx / nl) * LEECH_SHED_DISTANCE;
    e.z += (nz / nl) * LEECH_SHED_DISTANCE;
  }
  link.latchedCount = 0;
  link.cut = false;
}

/** Keeps a circle of radius r inside the arena; removes the outward velocity component. */
export function clampToArena(p: PlayerEntity): void {
  const lim = ARENA.RADIUS - p.radius;
  const r2 = p.x * p.x + p.z * p.z;
  if (r2 <= lim * lim) return;
  const r = Math.sqrt(r2);
  const nx = p.x / r;
  const nz = p.z / r;
  p.x = nx * lim;
  p.z = nz * lim;
  const out = p.vx * nx + p.vz * nz;
  if (out > 0) {
    p.vx -= out * nx;
    p.vz -= out * nz;
  }
}

/** Offline ghost: clamped inside the published camera view rect (inset), and the arena. */
export function clampGhostToView(w: WorldState, p: PlayerEntity): void {
  const v = w.viewRect;
  const inset = CAMERA.GHOST_INSET;
  const minX = v.minX + inset;
  const maxX = v.maxX - inset;
  const minZ = v.minZ + inset;
  const maxZ = v.maxZ - inset;
  if (minX <= maxX) p.x = p.x < minX ? minX : p.x > maxX ? maxX : p.x;
  if (minZ <= maxZ) p.z = p.z < minZ ? minZ : p.z > maxZ ? maxZ : p.z;
  clampToArena(p);
}
