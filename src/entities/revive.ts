/**
 * Co-op/solo down states: bleed-out, partner revive (cumulative progress with decay), automatic Spare Kernel
 * use, kernel respawn, the Offline ghost (Mark on touch), the no-living-player kernel rule and the wave-end
 * reboot. Everything here is a no-op in versus (Downed = eliminated for the round).
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type { PlayerEntity } from '../contracts/sim';
import type { SimSystem, WorldState } from '../contracts/world';
import { ARENA, COOP } from '../config/tuning';
import { markEnemy } from './damage';
import { emitPlayer } from './simEventsOut';

/** Players with life 'alive' (or 'respawning'). */
export function livingPlayerCount(w: WorldState): number {
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const l = w.players[i as PlayerIndex].life;
    if (l === 'alive' || l === 'respawning') n++;
  }
  return n;
}

function partnerOf(w: WorldState, p: PlayerEntity): PlayerEntity {
  return w.players[p.index === 0 ? 1 : 0];
}

/** Spends a team Spare Kernel on p: respawn after COOP.KERNEL_RESPAWN_DELAY. */
function spendKernel(w: WorldState, p: PlayerEntity): void {
  w.run.spareKernels--;
  p.life = 'respawning';
  p.respawnTimer = COOP.KERNEL_RESPAWN_DELAY;
  p.bleedLeft = 0;
  p.reviveProgress = 0;
  p.vx = 0;
  p.vz = 0;
  emitPlayer(w, p.index, 'kernel', w.run.spareKernels, p.x, p.z);
}

function revive(w: WorldState, p: PlayerEntity, hpFrac: number, invuln: number): void {
  p.life = 'alive';
  const hp = Math.round(p.stats.maxHp * hpFrac);
  p.hp = hp < 1 ? 1 : hp;
  const until = w.time + invuln;
  if (until > p.invulnUntil) p.invulnUntil = until;
  p.bleedLeft = 0;
  p.reviveProgress = 0;
  p.respawnTimer = 0;
  p.vx = 0;
  p.vz = 0;
}

function respawnPosition(w: WorldState, p: PlayerEntity): void {
  const q = partnerOf(w, p);
  if (q.life === 'alive' && q.index !== p.index) {
    let x = q.x + (p.index === 0 ? -2 : 2);
    let z = q.z;
    const lim = ARENA.RADIUS - p.radius;
    const r2 = x * x + z * z;
    if (r2 > lim * lim) {
      const k = lim / Math.sqrt(r2);
      x *= k;
      z *= k;
    }
    p.x = p.prevX = x;
    p.z = p.prevZ = z;
  }
}

function stepDowned(w: WorldState, p: PlayerEntity, dt: number): void {
  const q = partnerOf(w, p);
  const reviveTime = p.stats.reviveTime > 0.05 ? p.stats.reviveTime : 0.05;
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const near = q.life === 'alive' && dx * dx + dz * dz <= COOP.REVIVE_RADIUS * COOP.REVIVE_RADIUS;
  if (near) {
    p.reviveProgress += dt / reviveTime;
    if (p.reviveProgress >= 1) {
      revive(w, p, p.stats.reviveHpFrac, COOP.REVIVE_INVULN);
      q.revives++;
      emitPlayer(w, p.index, 'revived', p.hp, p.x, p.z);
      return;
    }
  } else if (p.reviveProgress > 0) {
    p.reviveProgress -= COOP.REVIVE_DECAY_PER_S * dt;
    if (p.reviveProgress < 0) p.reviveProgress = 0;
  }
  p.bleedLeft -= dt;
  if (p.bleedLeft > 0) return;
  p.bleedLeft = 0;
  if (w.run.spareKernels > 0) {
    spendKernel(w, p);
    return;
  }
  p.life = 'offline';
  p.reviveProgress = 0;
  emitPlayer(w, p.index, 'offline', 0, p.x, p.z);
}

function stepGhost(w: WorldState, p: PlayerEntity): void {
  const pool = w.enemies;
  for (let i = 0; i < pool.count; i++) {
    const e = pool.active[i]!;
    if (e.dying) continue;
    const r = e.radius + p.radius;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    if (dx * dx + dz * dz <= r * r) markEnemy(w, e);
  }
}

/** No living player: spend a kernel immediately on the player downed longest. */
function noLivingPlayerRule(w: WorldState): void {
  if (w.run.spareKernels <= 0 || livingPlayerCount(w) > 0) return;
  let pick: PlayerEntity | null = null;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    if (p.life !== 'downed') continue;
    if (pick === null || p.downedAt < pick.downedAt) pick = p;
  }
  if (pick !== null) spendKernel(w, pick);
}

export const stepRevive: SimSystem = (w: WorldState, _intents: Intents, dt: number): void => {
  if (w.mode === 'versus') return;
  noLivingPlayerRule(w);
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    switch (p.life) {
      case 'downed':
        stepDowned(w, p, dt);
        break;
      case 'respawning':
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          respawnPosition(w, p);
          revive(w, p, COOP.KERNEL_HP_FRAC, COOP.KERNEL_INVULN);
          emitPlayer(w, p.index, 'revived', p.hp, p.x, p.z);
        }
        break;
      case 'offline':
        stepGhost(w, p);
        break;
      case 'alive':
      case 'absent':
        break;
    }
  }
};

/** Wave-end reboot: Downed -> 40% hp, Offline -> 30% hp (co-op/solo). */
export function rebootAtWaveEnd(w: WorldState): void {
  if (w.mode === 'versus') return;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    if (p.life === 'absent') continue;
    p.downsThisWave = 0;
    if (p.life === 'alive') continue;
    const frac =
      p.life === 'downed'
        ? COOP.REBOOT_DOWNED_HP
        : p.life === 'offline'
          ? COOP.REBOOT_OFFLINE_HP
          : COOP.KERNEL_HP_FRAC;
    if (p.life === 'respawning') respawnPosition(w, p);
    revive(w, p, frac, 0);
    emitPlayer(w, p.index, 'reboot', p.hp, p.x, p.z);
  }
}
