/** Raw Shard wallet credit (split out of pickups.ts so combo.ts can grant sync-kill Shards without a cycle). */
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
