/**
 * Shard pickups: denominations with seeded scatter, magnet pull, blink/despawn, collection (shardGain, combo
 * bonus, catch-up, Offline ghost at 50%) and the wave-end vacuum.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type { PickupEntity, PlayerEntity } from '../contracts/sim';
import type { SimSystem, WorldState } from '../contracts/world';
import { ARENA, COOP, PICKUPS } from '../config/tuning';
import { comboShardBonus } from './combo';
import { grantShards, takeWholeShards } from './wallet';

export { grantShards } from './wallet';

export function spawnPickup(w: WorldState, x: number, z: number, value: number): PickupEntity | null {
  const p = w.pickups.spawn();
  if (p === null) return null;
  const lim = ARENA.RADIUS - 1;
  const r2 = x * x + z * z;
  if (r2 > lim * lim) {
    const k = lim / Math.sqrt(r2);
    x *= k;
    z *= k;
  }
  p.x = x;
  p.z = z;
  p.prevX = x;
  p.prevZ = z;
  p.vx = 0;
  p.vz = 0;
  p.value = value;
  p.age = 0;
  p.magnetTo = -1;
  return p;
}

/** Splits `total` into 25/5/1 denominations with seeded scatter. */
export function dropShards(w: WorldState, x: number, z: number, total: number): void {
  let left = Math.floor(total);
  const rng = w.rng.sim;
  const denoms = PICKUPS.DENOMINATIONS;
  for (let d = 0; d < denoms.length; d++) {
    const v = denoms[d]!;
    while (left >= v) {
      left -= v;
      const p = spawnPickup(w, x, z, v);
      if (p === null) return;
      const a = rng.range(0, Math.PI * 2);
      const sp = rng.range(0.5, 1) * PICKUPS.SCATTER_SPEED;
      p.vx = Math.sin(a) * sp;
      p.vz = Math.cos(a) * sp;
    }
  }
}

/**
 * Whole Shards player p collects for a pickup worth `value` (shardGain, combo bonus, catch-up, ghost 50%). The
 * exact product is credited through p's fractional carry (wallet.ts takeWholeShards), so it may be 0 or more
 * than the rounded product; the carry advances on every call.
 */
export function pickupValue(w: WorldState, p: Readonly<PlayerEntity>, value: number): number {
  let v = value * p.stats.shardGain * (1 + comboShardBonus(p));
  if (w.run.playerCount === 2) {
    const mine = w.run.wallets[p.index];
    const other = w.run.wallets[p.index === 0 ? 1 : 0];
    if (mine < other * PICKUPS.CATCHUP_RATIO) v *= 1 + PICKUPS.CATCHUP_BONUS;
  }
  if (p.life === 'offline') v *= COOP.OFFLINE_COLLECT_MUL;
  return takeWholeShards(w, p.index, v);
}

function collect(w: WorldState, p: PlayerEntity, k: PickupEntity): void {
  const credited = grantShards(w, p.index, pickupValue(w, p, k.value));
  const e = w.events.pickup.push();
  e.player = p.index;
  e.value = credited;
  e.x = k.x;
  e.z = k.z;
  e.combo = p.combo;
  w.pickups.despawn(k);
}

function canCollect(p: Readonly<PlayerEntity>, ghosts: boolean): boolean {
  return p.life === 'alive' || (ghosts && p.life === 'offline');
}

/**
 * Pickups collectable by Offline ghosts only outside versus (versus has no ghosts). Takes the pickup, not its
 * x/z: doubles passed to a call that is not inlined are boxed.
 */
function nearestCollector(w: WorldState, k: Readonly<PickupEntity>, ghosts: boolean): PlayerEntity | null {
  const x = k.x;
  const z = k.z;
  let best: PlayerEntity | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    if (!canCollect(p, ghosts)) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export const stepPickups: SimSystem = (w: WorldState, _intents: Intents, dt: number): void => {
  const pool = w.pickups;
  const ghosts = w.mode !== 'versus';
  const friction = 1 - PICKUPS.FRICTION * dt;
  const fr = friction > 0 ? friction : 0;
  for (let i = pool.count - 1; i >= 0; i--) {
    const k = pool.active[i]!;
    k.prevX = k.x;
    k.prevZ = k.z;
    k.age += dt;
    if (k.age >= PICKUPS.DESPAWN_AT) {
      pool.despawn(k);
      continue;
    }
    const p = nearestCollector(w, k, ghosts);
    k.magnetTo = -1;
    if (p !== null) {
      const dx = p.x - k.x;
      const dz = p.z - k.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= PICKUPS.COLLECT_RADIUS) {
        collect(w, p, k);
        continue;
      }
      if (d <= p.stats.magnetRadius) {
        k.magnetTo = p.index;
        k.vx = (dx / d) * PICKUPS.MAGNET_SPEED;
        k.vz = (dz / d) * PICKUPS.MAGNET_SPEED;
        const stepLen = PICKUPS.MAGNET_SPEED * dt;
        if (stepLen >= d - PICKUPS.COLLECT_RADIUS) {
          k.x = p.x;
          k.z = p.z;
          collect(w, p, k);
          continue;
        }
      }
    }
    if (k.magnetTo === -1) {
      k.vx *= fr;
      k.vz *= fr;
    }
    k.x += k.vx * dt;
    k.z += k.vz * dt;
  }
};

/** Credits every live pickup to the nearest living (else any present) player immediately, with pickup events. */
export function vacuumPickups(w: WorldState): void {
  const pool = w.pickups;
  for (let i = pool.count - 1; i >= 0; i--) {
    const k = pool.active[i]!;
    let best: PlayerEntity | null = null;
    let bestD = Infinity;
    let bestLiving = false;
    for (let j = 0; j < 2; j++) {
      const p = w.players[j as PlayerIndex];
      if (p.life === 'absent') continue;
      const living = p.life === 'alive' || p.life === 'respawning';
      const dx = p.x - k.x;
      const dz = p.z - k.z;
      const d = dx * dx + dz * dz;
      if ((living && !bestLiving) || (living === bestLiving && d < bestD)) {
        best = p;
        bestD = d;
        bestLiving = living;
      }
    }
    if (best === null) pool.despawn(k);
    else collect(w, best, k);
  }
}
