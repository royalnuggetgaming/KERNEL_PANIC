/**
 * System 7: grid rebuild (enemy SLOTS + radius), Firewall bullet deletion, swept player shots vs enemies
 * (grid AABB broadphase over the swept segment), boss parts and the versus opponent, enemy shots vs players,
 * enemy/boss contact and boss lasers. Swept segment-circle tests mean no tunnelling at any projectile speed.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import { PROJECTILE_KINDS, type PlayerEntity, type ProjectileEntity } from '../contracts/sim';
import { SOURCE_WORLD } from '../contracts/simEvents';
import type { SimSystem, WorldState } from '../contracts/world';
import { angleDiff, pointSegDistSq, segCircleHit } from '../core/math';
import { BOSS_DEFS } from '../config/bosses';
import { ENEMY_DEFS } from '../config/enemies';
import { ARENA, CAPACITY, COOP } from '../config/tuning';
import { VEHICLES } from '../config/vehicles';
import { arcChain, chainArcOnHit } from '../entities/cardEffects';
import { applyBossDamage, applyDamage, damagePlayer, isInvulnerable } from '../entities/damage';
import { firewallActive } from '../entities/specials';
import { emitExplosion, emitHit } from '../entities/simEventsOut';

const CANDS = new Int32Array(ARENA.GRID_CAPACITY);
/** Targets hit by the current shot this tick (pierce never hits the same target twice in one sweep). */
const HITS = new Int32Array(8);
/** Hit codes: enemy slot, BOSS_CODE + part, PLAYER_CODE + index. */
const BOSS_CODE = CAPACITY.enemies;
const PLAYER_CODE = CAPACITY.enemies + CAPACITY.bossParts;
/** Laser damage is applied in chunks sharing the player's contact cooldown. */
export const LASER_TICK = COOP.CONTACT_COOLDOWN;
const TINKER_CHAIN = VEHICLES.tinker.weapon.chain;
const TINKER_CHAIN_RANGE = VEHICLES.tinker.weapon.chainRange;

function rebuildGrid(w: WorldState): void {
  const g = w.grid;
  g.begin();
  const pool = w.enemies;
  for (let i = 0; i < pool.count; i++) {
    const e = pool.active[i]!;
    if (!e.dying) g.add(e.slot, e.x, e.z, e.radius);
  }
  g.build();
}

function hitBefore(code: number, n: number): boolean {
  for (let k = 0; k < n; k++) if (HITS[k] === code) return true;
  return false;
}

/** Weapon projectiles trigger on-hit card effects; missiles, mines and turret shots do not. */
function isWeaponShot(kind: number): boolean {
  return (
    kind === PROJECTILE_KINDS.bolt ||
    kind === PROJECTILE_KINDS.pellet ||
    kind === PROJECTILE_KINDS.needle ||
    kind === PROJECTILE_KINDS.arc
  );
}

/** Missiles and the Patch Drone turret target enemies only (never PvP). */
function canHitOpponent(w: WorldState, s: ProjectileEntity): boolean {
  return (
    w.mode === 'versus' &&
    (s.owner === 0 || s.owner === 1) &&
    s.kind !== PROJECTILE_KINDS.missile &&
    s.kind !== PROJECTILE_KINDS.turret
  );
}

const BEST = { t: 2, code: -1 };

function findFirstHit(w: WorldState, s: ProjectileEntity, n: number, hits: number): void {
  BEST.t = 2;
  BEST.code = -1;
  const ax = s.prevX;
  const az = s.prevZ;
  const bx = s.x;
  const bz = s.z;
  const pool = w.enemies;
  for (let c = 0; c < n; c++) {
    const e = pool.atSlot(CANDS[c]!);
    if (!pool.isAlive(e) || e.dying || e.slot === s.lastHit || hitBefore(e.slot, hits)) continue;
    const t = segCircleHit(ax, az, bx, bz, e.x, e.z, e.radius + s.radius);
    if (t >= 0 && t < BEST.t) {
      BEST.t = t;
      BEST.code = e.slot;
    }
  }
  for (let k = 0; k < w.bosses.length; k++) {
    const b = w.bosses[k]!;
    const code = BOSS_CODE + k;
    if (!b.alive || b.introTimer > 0 || s.lastHit === code || hitBefore(code, hits)) continue;
    const t = segCircleHit(ax, az, bx, bz, b.x, b.z, b.radius + s.radius);
    if (t >= 0 && t < BEST.t) {
      BEST.t = t;
      BEST.code = code;
    }
  }
  if (!canHitOpponent(w, s)) return;
  const q = w.players[s.owner === 0 ? 1 : 0];
  const code = PLAYER_CODE + q.index;
  if (q.life !== 'alive' || isInvulnerable(w, q) || s.lastHit === code || hitBefore(code, hits)) return;
  const t = segCircleHit(ax, az, bx, bz, q.x, q.z, q.radius + s.radius);
  if (t >= 0 && t < BEST.t) {
    BEST.t = t;
    BEST.code = code;
  }
}

/** Applies one hit; returns true when the shot is consumed regardless of pierce (shield block, mine). */
function applyShotHit(w: WorldState, s: ProjectileEntity, owner: PlayerIndex, code: number): boolean {
  const mine = s.kind === PROJECTILE_KINDS.mine;
  if (code >= PLAYER_CODE) {
    const q = w.players[(code - PLAYER_CODE) as PlayerIndex];
    damagePlayer(w, q, s.damage, owner, s.prevX, s.prevZ, mine ? 'pvpSpecial' : 'pvp');
  } else if (code >= BOSS_CODE) {
    applyBossDamage(w, w.bosses[code - BOSS_CODE]!, s.damage, owner, s.crit);
  } else {
    const e = w.enemies.atSlot(code);
    const ex = e.x;
    const ez = e.z;
    const dealt = applyDamage(w, e, s.damage, owner, s.prevX, s.prevZ, s.crit);
    if (dealt <= 0) return true;
    if (s.kind === PROJECTILE_KINDS.arc) {
      arcChain(w, owner, ex, ez, s.damage, TINKER_CHAIN, TINKER_CHAIN_RANGE, code);
    }
    if (isWeaponShot(s.kind)) chainArcOnHit(w, owner, ex, ez, s.damage, code);
  }
  if (mine) {
    emitExplosion(w, s.x, s.z, 1.5, 0.5);
    return true;
  }
  return false;
}

function playerShots(w: WorldState): void {
  const pool = w.playerShots;
  const g = w.grid;
  for (let i = pool.count - 1; i >= 0; i--) {
    const s = pool.active[i]!;
    const owner = s.owner;
    if (owner !== 0 && owner !== 1) continue;
    const r = s.radius;
    const minX = (s.prevX < s.x ? s.prevX : s.x) - r;
    const maxX = (s.prevX > s.x ? s.prevX : s.x) + r;
    const minZ = (s.prevZ < s.z ? s.prevZ : s.z) - r;
    const maxZ = (s.prevZ > s.z ? s.prevZ : s.z) + r;
    const n = g.queryAabb(minX, minZ, maxX, maxZ, CANDS);
    let hits = 0;
    while (hits < HITS.length) {
      findFirstHit(w, s, n, hits);
      if (BEST.code < 0) break;
      HITS[hits++] = BEST.code;
      s.lastHit = BEST.code;
      const consumed = applyShotHit(w, s, owner, BEST.code);
      if (consumed || s.pierce <= 0) {
        pool.despawn(s);
        break;
      }
      s.pierce--;
    }
  }
}

function firewallDeletion(w: WorldState): void {
  for (let pi = 0; pi < 2; pi++) {
    const p = w.players[pi as PlayerIndex];
    if (!firewallActive(p)) continue;
    const cx = p.special.x;
    const cz = p.special.z;
    const r2 = p.special.radius * p.special.radius;
    const es = w.enemyShots;
    for (let i = es.count - 1; i >= 0; i--) {
      const s = es.active[i]!;
      const dx = s.x - cx;
      const dz = s.z - cz;
      if (dx * dx + dz * dz > r2) continue;
      emitHit(w, s.x, s.z, 0, false, 2, p.index);
      es.despawn(s);
    }
    if (w.mode !== 'versus') continue;
    const ps = w.playerShots;
    for (let i = ps.count - 1; i >= 0; i--) {
      const s = ps.active[i]!;
      if (s.owner === p.index || s.owner === SOURCE_WORLD) continue;
      const dx = s.x - cx;
      const dz = s.z - cz;
      if (dx * dx + dz * dz > r2) continue;
      emitHit(w, s.x, s.z, 0, false, 2, p.index);
      ps.despawn(s);
    }
  }
}

function enemyShots(w: WorldState): void {
  const pool = w.enemyShots;
  for (let i = pool.count - 1; i >= 0; i--) {
    const s = pool.active[i]!;
    let bestT = 2;
    let target: PlayerEntity | null = null;
    for (let pi = 0; pi < 2; pi++) {
      const p = w.players[pi as PlayerIndex];
      if (p.life !== 'alive' || isInvulnerable(w, p)) continue;
      const t = segCircleHit(s.prevX, s.prevZ, s.x, s.z, p.x, p.z, p.radius + s.radius);
      if (t >= 0 && t < bestT) {
        bestT = t;
        target = p;
      }
    }
    if (target === null) continue;
    damagePlayer(w, target, s.damage, SOURCE_WORLD, s.prevX, s.prevZ, 'projectile');
    pool.despawn(s);
  }
}

function contact(w: WorldState): void {
  for (let pi = 0; pi < 2; pi++) {
    const p = w.players[pi as PlayerIndex];
    if (p.life !== 'alive' || p.contactCd > 0 || isInvulnerable(w, p)) continue;
    let dmg = 0;
    let fx = p.x;
    let fz = p.z;
    const n = w.grid.queryCircle(p.x, p.z, p.radius, CANDS);
    for (let c = 0; c < n; c++) {
      const e = w.enemies.atSlot(CANDS[c]!);
      if (e.dying) continue;
      const d = ENEMY_DEFS[e.kind].contactDamage;
      if (d > dmg) {
        dmg = d;
        fx = e.x;
        fz = e.z;
      }
    }
    for (let k = 0; k < w.bosses.length; k++) {
      const b = w.bosses[k]!;
      if (!b.alive) continue;
      const rr = b.radius + p.radius;
      const dx = b.x - p.x;
      const dz = b.z - p.z;
      if (dx * dx + dz * dz > rr * rr) continue;
      const d = BOSS_DEFS[b.id].contactDamage;
      if (d > dmg) {
        dmg = d;
        fx = b.x;
        fz = b.z;
      }
    }
    if (dmg <= 0) continue;
    damagePlayer(w, p, dmg, SOURCE_WORLD, fx, fz, 'contact');
    p.contactCd = COOP.CONTACT_COOLDOWN;
  }
}

/** Laser convention: direction (sin(angle), cos(angle)); `damage` is damage per second. */
function lasers(w: WorldState): void {
  const pool = w.lasers;
  for (let i = 0; i < pool.count; i++) {
    const l = pool.active[i]!;
    if (l.warmup > 0) continue;
    for (let pi = 0; pi < 2; pi++) {
      const p = w.players[pi as PlayerIndex];
      if (p.life !== 'alive' || p.contactCd > 0 || isInvulnerable(w, p)) continue;
      const reach = l.width / 2 + p.radius;
      let hit = false;
      if (l.shape === 0) {
        const bx = l.x + Math.sin(l.angle) * l.length;
        const bz = l.z + Math.cos(l.angle) * l.length;
        hit = pointSegDistSq(p.x, p.z, l.x, l.z, bx, bz) <= reach * reach;
      } else {
        const dx = p.x - l.x;
        const dz = p.z - l.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (Math.abs(d - l.radius) <= reach && d > 1e-6) {
          const slack = l.radius > 0 ? p.radius / l.radius : 0;
          hit = Math.abs(angleDiff(l.angle, Math.atan2(dx, dz))) <= l.arcHalf + slack;
        }
      }
      if (!hit) continue;
      damagePlayer(w, p, l.damage * LASER_TICK, SOURCE_WORLD, l.x, l.z, 'laser');
      p.contactCd = LASER_TICK;
    }
  }
}

export const stepCollision: SimSystem = (w: WorldState, _intents: Intents, _dt: number): void => {
  rebuildGrid(w);
  firewallDeletion(w);
  playerShots(w);
  enemyShots(w);
  contact(w);
  lasers(w);
};
