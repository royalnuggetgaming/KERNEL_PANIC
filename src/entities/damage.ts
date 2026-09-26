/**
 * Damage resolution. Enemies: Warden front arc, Mark, hit flash, damage/overdrive credit, kills (combo, drops,
 * kill event, DeathRecord). Bosses: hp only (phases/death in stepBoss). Players: i-frames, Nanoshield, armor
 * (contact), PvP multipliers, combo halving, downed/eliminated.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { BossEntity, EnemyEntity, PlayerEntity } from '../contracts/sim';
import { SOURCE_LINK, type DamageSource } from '../contracts/simEvents';
import type { WorldState } from '../contracts/world';
import { DEG2RAD, inArc } from '../core/math';
import { CORRUPTED, ENEMY_DEFS } from '../config/enemies';
import { COOP, OVERDRIVE } from '../config/tuning';
import { VERSUS } from '../config/versus';
import { CARD_BIT, hasCard } from './cardBits';
import { registerKill, registerPlayerHit } from './combo';
import { addOverdrive } from './overdrive';
import { dropShards } from './pickups';
import { emitHit, emitPlayer, isPlayerSource } from './simEventsOut';

export type PlayerDamageKind = 'contact' | 'projectile' | 'laser' | 'pvp' | 'pvpSpecial';

const WARDEN_HALF_ARC = (ENEMY_DEFS.warden.params.shieldArcDeg / 2) * DEG2RAD;
/** Score per threat-budget point of a killed enemy. */
export const SCORE_PER_COST = 10;

function creditDamage(w: WorldState, source: DamageSource, dealt: number): void {
  if (dealt <= 0) return;
  if (isPlayerSource(source)) {
    const p = w.players[source];
    p.damageDealt += dealt;
    addOverdrive(w, source, dealt * OVERDRIVE.PER_DAMAGE);
  } else if (source === SOURCE_LINK) {
    // Link damage charges both linked players' meters equally.
    const half = dealt * OVERDRIVE.PER_DAMAGE * 0.5;
    if (w.players[0].life === 'alive') addOverdrive(w, 0, half);
    if (w.players[1].life === 'alive') addOverdrive(w, 1, half);
  }
}

/** True when a Warden's front shield faces the damage origin. */
export function wardenBlocks(e: Readonly<EnemyEntity>, fromX: number, fromZ: number): boolean {
  return e.kind === 'warden' && inArc(e.yaw, WARDEN_HALF_ARC, fromX - e.x, fromZ - e.z);
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
  if (e.dying || e.hp <= 0 || !(amount > 0)) return 0;
  const hitPlayer: PlayerIndex | -1 = isPlayerSource(source) ? source : -1;
  if (wardenBlocks(e, fromX, fromZ)) {
    emitHit(w, e.x, e.z, 0, false, 2, hitPlayer);
    return 0;
  }
  let dmg = amount;
  if (w.time < e.markedUntil) dmg *= 1 + COOP.MARK_BONUS;
  const dealt = dmg < e.hp ? dmg : e.hp;
  e.hp -= dmg;
  e.flash = 1;
  e.lastHitBy = source;
  creditDamage(w, source, dealt);
  emitHit(w, e.x, e.z, dmg, crit, 0, hitPlayer);
  if (e.hp > 0) return dealt;
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
  return dealt;
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
  creditDamage(w, source, dealt);
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
