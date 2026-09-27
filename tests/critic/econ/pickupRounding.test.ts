/**
 * ECON critic reproduction (FAILS on current code): percentage Shard modifiers are rounded PER PICKUP
 * (entities/pickups.ts pickupValue: Math.round(value x shardGain x (1 + combo)) x catch-up x ghost, min 1),
 * but ~99% of spawned pickups are worth 1 (drops decompose into [25, 5, 1] denominations and most drops are
 * 1-4; measured 98.7-99.4% over waves 1-9, see scratchpad/critic/econ/pickupRounding.ts). So for almost every
 * pickup:
 * - combo tiers (+10/20/30/40%, plan section 1) add nothing: round(1.1..1.4) = 1;
 * - the catch-up bonus (+20%) adds nothing: round(1.2) = 1;
 * - the Offline ghost's 50% becomes 100%: round(0.5) = 1;
 * - Bounty (+20%/+40%) is 0% or +100% depending on the combo tier (1.4 x 1.1 = 1.54 -> 2).
 * Measured A/B (solo, same seed, Bounty x2 vs none, waves 3-9): realised +51..61% instead of +40%.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerIndex } from '../../../src/contracts/ids';
import type { WorldState } from '../../../src/contracts/world';
import { pickupValue } from '../../../src/entities/pickups';
import { createTestWorld } from '../../helpers/worldFixture';

function credit20(w: WorldState, p: PlayerIndex): number {
  let sum = 0;
  for (let i = 0; i < 20; i++) sum += pickupValue(w, w.players[p], 1);
  return sum;
}

describe('ECON: Shard bonuses survive integer rounding on 1-value pickups', () => {
  it('combo tier 4 (+40%) pays about +40% over 20 one-Shard pickups', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    p.combo = 120;
    p.comboTier = 4;
    p.comboTimer = 2;
    // Observed: 20 (bonus lost entirely).
    expect(credit20(w, 0)).toBeGreaterThanOrEqual(27);
  });

  it('the catch-up bonus (+20%) pays about +20% to the poorer co-op player', () => {
    const w = createTestWorld({ mode: 'coop' });
    w.run.wallets[0] = 10;
    w.run.wallets[1] = 1_000;
    // Observed: 20.
    expect(credit20(w, 0)).toBeGreaterThanOrEqual(23);
  });

  it('an Offline ghost collects at about 50% value', () => {
    const w = createTestWorld({ mode: 'coop' });
    w.players[0].life = 'offline';
    // Observed: 20 (100%).
    expect(credit20(w, 0)).toBeLessThanOrEqual(11);
  });

  it('Bounty (+20%) pays about +20% without a combo', () => {
    const w = createTestWorld({ mode: 'solo' });
    w.players[0].stats.shardGain = 1.2;
    // Observed: 20.
    expect(credit20(w, 0)).toBeGreaterThanOrEqual(23);
  });
});
