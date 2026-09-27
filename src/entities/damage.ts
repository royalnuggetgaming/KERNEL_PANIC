/**
 * Damage resolution. Enemies: Warden front arc, Mark, hit flash, damage/overdrive credit, kills (combo, drops,
 * kill event, DeathRecord). Bosses: hp only (phases/death in stepBoss). Players: i-frames, Nanoshield, armor
 * (contact), PvP multipliers, combo halving, downed/eliminated.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { BossEntity, EnemyEntity, PlayerEntity } from '../contracts/sim';
import { SOURCE_LINK, type DamageSource } from '../contracts/simEvents';
import type { WorldState } from '../contracts/world';
import { DEG2RAD, TAU, inArc } from '../core/math';
import { CORRUPTED, ENEMY_DEFS } from '../config/enemies';
import { COOP, OVERDRIVE } from '../config/tuning';
import { VERSUS } from '../config/versus';
import { CARD_BIT, hasCard } from './cardBits';
import { registerKill, registerPlayerHit } from './combo';
import { dropShards } from './pickups';
import { emitHit, emitPlayer, isPlayerSource } from './simEventsOut';

export type PlayerDamageKind = 'contact' | 'projectile' | 'laser' | 'pvp' | 'pvpSpecial';

const WARDEN_HALF_ARC = (ENEMY_DEFS.warden.params.shieldArcDeg / 2) * DEG2RAD;
/** Score per threat-budget point of a killed enemy. */
export const SCORE_PER_COST = 10;

/**
 * Scratch inputs of hitEnemy: [amount, fromX, fromZ]. Per-hit callers (collision, arcs, rails) write it and call
 * hitEnemy instead of applyDamage: a call TurboFan does not inline boxes every fractional double argument into a
 * HeapNumber, and this path runs for every projectile hit (plan section 10.2, zero hot-path allocation).
 */
export const HIT_IN = new Float64Array(3);
/** [damage dealt by the last hitEnemy / applyBossDamage call] (kept out of return values for the same reason). */
const DEALT = new Float64Array(1);

/** addOverdrive(p, DEALT[0] x PER_DAMAGE x share), same arithmetic, without a boxed amount argument. */
function chargeFromDealt(pl: PlayerEntity, share: number): void {
  const amount = DEALT[0]! * OVERDRIVE.PER_DAMAGE * share;
  if (pl.life === 'absent' || !(amount > 0)) return;
  const v = pl.overdrive + amount * pl.stats.specialChargeMul;
  pl.overdrive = v > OVERDRIVE.MAX ? OVERDRIVE.MAX : v;
}

/** Credits DEALT[0] to the source's damageDealt and Overdrive (link damage charges both linked players). */
function creditDamage(w: WorldState, source: DamageSource): void {
  const dealt = DEALT[0]!;
  if (dealt <= 0) return;
  if (isPlayerSource(source)) {
    const p = w.players[source];
    p.damageDealt += dealt;
    chargeFromDealt(p, 1);
  } else if (source === SOURCE_LINK) {
    if (w.players[0].life === 'alive') chargeFromDealt(w.players[0], 0.5);
    if (w.players[1].life === 'alive') chargeFromDealt(w.players[1], 0.5);
  }
}

/** True when a Warden's front shield faces the damage origin. */
export function wardenBlocks(e: Readonly<EnemyEntity>, fromX: number, fromZ: number): boolean {
  return e.kind === 'warden' && inArc(e.yaw, WARDEN_HALF_ARC, fromX - e.x, fromZ - e.z);
}

/** wardenBlocks for the origin in HIT_IN (same arithmetic as core/math inArc, inlined: no boxed arguments). */
function shieldBlocksHit(e: Readonly<EnemyEntity>): boolean {
  if (e.kind !== 'warden') return false;
  const dx = HIT_IN[1]! - e.x;
  const dz = HIT_IN[2]! - e.z;
  if (dx === 0 && dz === 0) return false;
  let d = (Math.atan2(dx, dz) - e.yaw) % TAU;
  if (d <= -Math.PI) d += TAU;
  else if (d > Math.PI) d -= TAU;
  return Math.abs(d) <= WARDEN_HALF_ARC;
}

function pushEnemyHit(
  w: WorldState,
  e: Readonly<EnemyEntity>,
  crit: boolean,
  target: 0 | 2,
  player: PlayerIndex | -1,
): void {
  const h = w.events.hit.push();
  h.x = e.x;
  h.z = e.z;
  h.amount = target === 0 ? HIT_IN[0]! : 0;
  h.crit = crit;
  h.target = target;
  h.player = player;
}

/**
 * applyDamage with the amount and origin read from HIT_IN. Returns true when damage was dealt (the amount is then
 * readable through lastDealt()).
 */
export function hitEnemy(w: WorldState, e: EnemyEntity, source: DamageSource, crit: boolean): boolean {
  DEALT[0] = 0;
  const amount = HIT_IN[0]!;
  if (e.dying || e.hp <= 0 || !(amount > 0)) return false;
  const hitPlayer: PlayerIndex | -1 = isPlayerSource(source) ? source : -1;
  if (shieldBlocksHit(e)) {
    pushEnemyHit(w, e, false, 2, hitPlayer);
    return false;
  }
  if (w.time < e.markedUntil) HIT_IN[0] = amount * (1 + COOP.MARK_BONUS);
  const dmg = HIT_IN[0]!;
  DEALT[0] = dmg < e.hp ? dmg : e.hp;
  e.hp -= dmg;
  e.flash = 1;
  e.lastHitBy = source;
  creditDamage(w, source);
  pushEnemyHit(w, e, crit, 0, hitPlayer);
  if (e.hp > 0) return true;
  killEnemy(w, e, source, hitPlayer);
  return true;
}

/** Damage dealt by the last hitEnemy / applyDamage / applyBossDamage call. */
export function lastDealt(): number {
  return DEALT[0]!;
}

function killEnemy(w: WorldState, e: EnemyEntity, source: DamageSource, hitPlayer: PlayerIndex | -1): void {
  const dealt = DEALT[0]!;
  e.hp = 0;
  e.dying = true;
  const def = ENEMY_DEFS[e.kind];
  const eliteMul = e.elite ? CORRUPTED.dropMul : 1;
  registerKill(w, source, e.x, e.z, def.cost * SCORE_PER_COST * eliteMul);
  dropShards(w, e.x, e.z, def.drop * eliteMul);
  const k = w.events.kill.push();
  k.kind = e.kind;
  k.x = e.x;
  k.z = e.z;
  k.by = source;
  k.elite = e.elite;
  k.combo = hitPlayer === -1 ? 0 : w.players[hitPlayer].combo;
  const d = w.deathQueue.push();
  d.slot = e.slot;
  d.kind = e.kind;
  d.elite = e.elite;
  d.x = e.x;
  d.z = e.z;
  d.vx = e.vx;
  d.vz = e.vz;
  d.by = source;
  d.splitGen = e.splitGen;
  d.seed = e.seed;
  DEALT[0] = dealt;
}

/**
 * Damage to an enemy: Warden front arc (from fromX/fromZ) blocks, crit already rolled by the caller, Mark +20%,
 * hit flash, damageDealt/overdrive credit. On kill: dying = true, score/combo (registerKill), drops (dropShards),
 * kill event, DeathRecord pushed to w.deathQueue. Returns damage dealt (0 when blocked or already dying).
 */
export function applyDamage(
  w: WorldState,
  e: EnemyEntity,
  amount: number,
  source: DamageSource,
  fromX: number,
  fromZ: number,
  crit: boolean,
): number {
  HIT_IN[0] = amount;
  HIT_IN[1] = fromX;
  HIT_IN[2] = fromZ;
  return hitEnemy(w, e, source, crit) ? DEALT[0]! : 0;
}

/** Boss part damage (hp clamped at 0, flash, lastHitBy, hit event). Phases/death are handled by stepBoss. */
export function applyBossDamage(
  w: WorldState,
  b: BossEntity,
  amount: number,
  source: DamageSource,
  crit: boolean,
): number {
  if (!b.alive || b.hp <= 0 || !(amount > 0)) return 0;
  const dealt = amount < b.hp ? amount : b.hp;
  b.hp -= dealt;
  b.flash = 1;
  b.lastHitBy = source;
  DEALT[0] = dealt;
  creditDamage(w, source);
  emitHit(w, b.x, b.z, amount, crit, 3, isPlayerSource(source) ? source : -1);
  return dealt;
}

/** Downs a player (hp 0). Versus: eliminated for the round. Co-op/solo: bleed-out starts. */
export function downPlayer(w: WorldState, p: PlayerEntity): void {
  p.hp = 0;
  p.life = 'downed';
  p.vx = 0;
  p.vz = 0;
  p.dashTimer = 0;
  p.special.active = false;
  p.special.pendingCasts = 0;
  p.downedAt = w.time;
  p.reviveProgress = 0;
  if (w.mode === 'versus') {
    p.bleedLeft = 0;
    emitPlayer(w, p.index, 'eliminated', 0, p.x, p.z);
    return;
  }
  const bleed = COOP.BLEED_OUT - COOP.BLEED_STEP * p.downsThisWave;
  p.bleedLeft = bleed > COOP.BLEED_MIN ? bleed : COOP.BLEED_MIN;
  p.downsThisWave++;
  emitPlayer(w, p.index, 'downed', 0, p.x, p.z);
}

/** True while dash i-frames or any invulnerability window is running. */
export function isInvulnerable(w: WorldState, p: Readonly<PlayerEntity>): boolean {
  return w.time < p.invulnUntil;
}

/**
 * Damage to a player: i-frames/invulnUntil, Nanoshield, armor (contact only), PvP multipliers when source is a
 * player (VERSUS.PVP_DAMAGE_MUL / PVP_SPECIAL_DAMAGE_MUL), combo halving, hurt event; hp <= 0 -> 'downed'
 * (co-op/solo bleed-out starts; versus: eliminated, 'eliminated' event). Returns damage taken.
 */
export function damagePlayer(
  w: WorldState,
  p: PlayerEntity,
  amount: number,
  source: DamageSource,
  fromX: number,
  fromZ: number,
  kind: PlayerDamageKind,
): number {
  if (p.life !== 'alive' || !(amount > 0) || isInvulnerable(w, p)) return 0;
  let dmg = amount;
  if (isPlayerSource(source)) {
    // No friendly fire outside versus, never self damage.
    if (w.mode !== 'versus' || source === p.index) return 0;
    dmg *= kind === 'pvpSpecial' ? VERSUS.PVP_SPECIAL_DAMAGE_MUL : VERSUS.PVP_DAMAGE_MUL;
  }
  if (hasCard(p, CARD_BIT.nanoshield) && p.cards.nanoshieldReady) {
    p.cards.nanoshieldReady = false;
    p.cards.nanoshieldTimer = 0;
    emitPlayer(w, p.index, 'shieldBlock', dmg, fromX, fromZ);
    emitHit(w, p.x, p.z, 0, false, 2, p.index);
    return 0;
  }
  if (kind === 'contact') dmg *= 1 - p.stats.armor;
  if (dmg <= 0) return 0;
  const taken = dmg < p.hp ? dmg : p.hp;
  p.hp -= dmg;
  p.damageTaken += taken;
  p.hitFlash = 1;
  registerPlayerHit(w, p.index);
  emitPlayer(w, p.index, 'hurt', taken, fromX, fromZ);
  emitHit(w, p.x, p.z, taken, false, 1, p.index);
  if (p.hp <= 0) downPlayer(w, p);
  return taken;
}

/** Offline ghost touch: +20% damage taken for COOP.MARK_DURATION. */
export function markEnemy(w: WorldState, e: EnemyEntity): void {
  if (e.dying) return;
  e.markedUntil = w.time + COOP.MARK_DURATION;
}
