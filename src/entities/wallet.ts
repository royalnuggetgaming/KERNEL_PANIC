/**
 * Raw Shard wallet credit (split out of pickups.ts so combo.ts can grant sync-kill Shards without a cycle) and
 * the per-player fractional Shard carry that keeps percentage bonuses exact on small pickups.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { WorldState } from '../contracts/world';
import { ECONOMY } from '../config/tuning';

/** Raw wallet credit (clamped to ECONOMY.WALLET_MAX, adds to shardsEarned); returns credited amount. */
export function grantShards(w: WorldState, p: PlayerIndex, amount: number): number {
  if (!(amount >= 1) || w.players[p].life === 'absent') return 0;
  const wallets = w.run.wallets;
  const room = ECONOMY.WALLET_MAX - wallets[p];
  const want = Math.floor(amount);
  const credited = want < room ? want : room;
  if (credited <= 0) return 0;
  wallets[p] += credited;
  w.run.shardsEarned[p] += credited;
  return credited;
}

/**
 * Fractional Shards owed to each player ([p0, p1], each in [0, 1)), per world. Kept outside the world object
 * (the WorldState contract is frozen) like combo.ts's sync memory; stateHash mixes it and resetWorld clears it.
 */
const carries = new WeakMap<WorldState, Float64Array>();

/** This world's carry, created on first use. */
export function shardCarry(w: WorldState): Float64Array {
  let c = carries.get(w);
  if (c === undefined) {
    c = new Float64Array(2);
    carries.set(w, c);
  }
  return c;
}

/** Read-only carry for sim/stateHash: 0 when this world never carried a fraction. */
export function shardCarryOf(w: WorldState, p: PlayerIndex): number {
  const c = carries.get(w);
  return c === undefined ? 0 : c[p]!;
}

/** Clears both players' carry (a new run on a recycled world). */
export function resetShardCarry(w: WorldState): void {
  const c = carries.get(w);
  if (c !== undefined) c.fill(0);
}

/** Absorbs float noise so 20 x 1.2 credits 24, not 23 (far below any real fraction of a Shard). */
const CARRY_EPS = 1e-9;

/**
 * Whole Shards to credit player p for an exact (fractional) amount: floor(amount + carry), keeping the rest
 * as p's carry. Percentage bonuses therefore pay exactly over many 1-Shard pickups instead of rounding away.
 */
export function takeWholeShards(w: WorldState, p: PlayerIndex, amount: number): number {
  const c = shardCarry(w);
  const exact = amount + c[p]!;
  const whole = Math.floor(exact + CARRY_EPS);
  const rest = exact - whole;
  c[p] = rest > 0 ? rest : 0;
  return whole;
}
