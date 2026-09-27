/**
 * System 7: grid rebuild (enemy SLOTS + radius), Firewall bullet deletion, swept player shots vs enemies
 * (grid AABB broadphase over the swept segment), boss parts and the versus opponent, enemy shots vs players,
 * enemy/boss contact and boss lasers. Swept segment-circle tests mean no tunnelling at any projectile speed.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import {
  PROJECTILE_KINDS,
  type BossEntity,
  type EnemyEntity,
  type PlayerEntity,
  type ProjectileEntity,
} from '../contracts/sim';
import { SOURCE_WORLD } from '../contracts/simEvents';
import type { SimSystem, WorldState } from '../contracts/world';
import { angleDiff, pointSegDistSq } from '../core/math';
import { BOSS_DEFS } from '../config/bosses';
import { ENEMY_DEFS } from '../config/enemies';
import { ARENA, CAPACITY, COOP } from '../config/tuning';
import { VEHICLES } from '../config/vehicles';
import { arcChainFromShot, chainArcFromShot } from '../entities/cardEffects';
import { HIT_IN, applyBossDamage, damagePlayer, hitEnemy, isInvulnerable } from '../entities/damage';
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
/** The swept shot being resolved and the circle tested against it: [ax, az, bx, bz, shot radius, cx, cz, r]. */
const SEG = new Float64Array(8);

function loadSegment(s: Readonly<ProjectileEntity>): void {
  SEG[0] = s.prevX;
  SEG[1] = s.prevZ;
  SEG[2] = s.x;
  SEG[3] = s.z;
  SEG[4] = s.radius;
}

/**
 * core/math segCircleHit of the SEG sweep against the SEG circle (its radius + the shot radius), same arithmetic,
 * inlined here so the per-shot loops pass no boxed doubles (callers copy the circle into SEG from a monomorphic
 * site). Records `code` in BEST when it is hit earlier than the best so far.
 */
function sweep(code: number): void {
  const ax = SEG[0]!;
  const az = SEG[1]!;
  const r = SEG[7]! + SEG[4]!;
  const fx = ax - SEG[5]!;
  const fz = az - SEG[6]!;
  const cc = fx * fx + fz * fz - r * r;
  let t = 0;
  if (cc > 0) {
    const dx = SEG[2]! - ax;
    const dz = SEG[3]! - az;
    const a = dx * dx + dz * dz;
    if (a <= 1e-12) return;
    const b = 2 * (fx * dx + fz * dz);
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return;
    t = (-b - Math.sqrt(disc)) / (2 * a);
    if (!(t >= 0 && t <= 1)) return;
  }
  if (t < BEST.t) {
    BEST.t = t;
    BEST.code = code;
  }
}

function sweepEnemy(e: Readonly<EnemyEntity>): void {
  SEG[5] = e.x;
  SEG[6] = e.z;
  SEG[7] = e.radius;
  sweep(e.slot);
}

function sweepBoss(b: Readonly<BossEntity>, code: number): void {
  SEG[5] = b.x;
  SEG[6] = b.z;
  SEG[7] = b.radius;
  sweep(code);
}

function sweepPlayer(p: Readonly<PlayerEntity>, code: number): void {
  SEG[5] = p.x;
  SEG[6] = p.z;
  SEG[7] = p.radius;
  sweep(code);
}

function findFirstHit(w: WorldState, s: ProjectileEntity, n: number, hits: number): void {
  BEST.t = 2;
  BEST.code = -1;
  loadSegment(s);
  const pool = w.enemies;
  for (let c = 0; c < n; c++) {
    const e = pool.atSlot(CANDS[c]!);
    if (!pool.isAlive(e) || e.dying || e.slot === s.lastHit || hitBefore(e.slot, hits)) continue;
    sweepEnemy(e);
  }
  for (let k = 0; k < w.bosses.length; k++) {
    const b = w.bosses[k]!;
    const code = BOSS_CODE + k;
    if (!b.alive || b.introTimer > 0 || s.lastHit === code || hitBefore(code, hits)) continue;
    sweepBoss(b, code);
  }
  if (!canHitOpponent(w, s)) return;
  const q = w.players[s.owner === 0 ? 1 : 0];
  const code = PLAYER_CODE + q.index;
  if (q.life !== 'alive' || isInvulnerable(w, q) || s.lastHit === code || hitBefore(code, hits)) return;
  sweepPlayer(q, code);
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
    HIT_IN[0] = s.damage;
    HIT_IN[1] = s.prevX;
    HIT_IN[2] = s.prevZ;
    if (!hitEnemy(w, e, owner, s.crit)) return true;
    // Arcs start at the struck enemy (its position is unchanged by the hit; despawn happens in resolveDeaths).
    if (s.kind === PROJECTILE_KINDS.arc) arcChainFromShot(w, owner, e, s, TINKER_CHAIN, TINKER_CHAIN_RANGE);
    if (isWeaponShot(s.kind)) chainArcFromShot(w, owner, e, s);
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
    BEST.t = 2;
    BEST.code = -1;
    loadSegment(s);
    for (let pi = 0; pi < 2; pi++) {
      const p = w.players[pi as PlayerIndex];
      if (p.life !== 'alive' || isInvulnerable(w, p)) continue;
      sweepPlayer(p, pi);
    }
    if (BEST.code < 0) continue;
    const target = w.players[BEST.code as PlayerIndex];
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
