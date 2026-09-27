/**
 * ECON-1 regression: percentage Shard modifiers must survive integer crediting. ~99% of spawned pickups are worth
 * 1 (drops split into 25/5/1 and most drops are 1-4 Shards), so rounding each pickup on its own erased the combo
 * tiers (+10..40%), catch-up (+20%) and Bounty (+20%/+40%), and turned the Offline ghost's 50% into 100%. Pickups
 * now credit floor(exact + carry) and keep the fraction in a per-player carry (entities/wallet.ts), which is part
 * of stateHash and cleared by resetWorld.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerIndex } from '../../src/contracts/ids';
import type { WorldState } from '../../src/contracts/world';
import { pickupValue } from '../../src/entities/pickups';
import { shardCarry } from '../../src/entities/wallet';
import { resetWorld } from '../../src/sim/createWorld';
import { stateHash } from '../../src/sim/stateHash';
import { createTestWorld, testWorldConfig } from '../helpers/worldFixture';

function credit20(w: WorldState, p: PlayerIndex): number {
  let sum = 0;
  for (let i = 0; i < 20; i++) sum += pickupValue(w, w.players[p], 1);
  return sum;
}

describe('pickup Shard carry', () => {
  it('combo tier 4 (+40%) pays +40% over 20 one-Shard pickups', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    p.combo = 120;
    p.comboTier = 4;
    p.comboTimer = 2;
    expect(credit20(w, 0)).toBe(28);
  });

  it('the catch-up bonus (+20%) pays +20% to the poorer co-op player', () => {
    const w = createTestWorld({ mode: 'coop' });
    w.run.wallets[0] = 10;
    w.run.wallets[1] = 1_000;
    expect(credit20(w, 0)).toBe(24);
  });

  it('an Offline ghost collects at 50% value', () => {
    const w = createTestWorld({ mode: 'coop' });
    w.players[0].life = 'offline';
    expect(credit20(w, 0)).toBe(10);
  });

  it('Bounty (+20%) pays +20% without a combo', () => {
    const w = createTestWorld({ mode: 'solo' });
    w.players[0].stats.shardGain = 1.2;
    expect(credit20(w, 0)).toBe(24);
  });

  it('the carry is per player, part of stateHash and cleared by resetWorld', () => {
    const w = createTestWorld({ mode: 'coop' });
    w.players[0].stats.shardGain = 1.5;
    const h0 = stateHash(w);
    expect(pickupValue(w, w.players[0], 1)).toBe(1);
    expect(shardCarry(w)[0]).toBeCloseTo(0.5, 12);
    expect(shardCarry(w)[1]).toBe(0);
    expect(stateHash(w)).not.toBe(h0);
    resetWorld(w, testWorldConfig({ mode: 'coop' }));
    expect(shardCarry(w)[0]).toBe(0);
    expect(stateHash(w)).toBe(stateHash(createTestWorld({ mode: 'coop' })));
  });
});
