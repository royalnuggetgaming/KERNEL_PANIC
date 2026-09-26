import { describe, expect, it } from 'vitest';
import { ECONOMY, PICKUPS } from '../../src/config/tuning';
import {
  dropShards,
  grantShards,
  pickupValue,
  spawnPickup,
  stepPickups,
  vacuumPickups,
} from '../../src/entities/pickups';
import { addTestPickup, createTestWorld, placePlayer, stepSystem } from '../helpers/worldFixture';

function values(w: ReturnType<typeof createTestWorld>): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.pickups.count; i++) out.push(w.pickups.active[i]!.value);
  return out.sort((a, b) => b - a);
}

describe('pickups', () => {
  it('dropShards splits into 25/5/1 denominations with seeded scatter', () => {
    const w = createTestWorld();
    dropShards(w, 0, 0, 60);
    expect(values(w)).toEqual([25, 25, 5, 5]);
    dropShards(w, 0, 0, 3);
    expect(values(w).filter((v) => v === 1)).toHaveLength(3);
    const moving = w.pickups.active[0]!;
    expect(Math.hypot(moving.vx, moving.vz)).toBeGreaterThan(0);
    const a = createTestWorld({ seed: 7 });
    const b = createTestWorld({ seed: 7 });
    dropShards(a, 1, 1, 31);
    dropShards(b, 1, 1, 31);
    expect(a.pickups.active[0]!.vx).toBe(b.pickups.active[0]!.vx);
  });

  it('spawnPickup clamps inside the arena and returns null when full', () => {
    const w = createTestWorld();
    const p = spawnPickup(w, 100, 0, 1)!;
    expect(p.x).toBeLessThan(32);
    for (let i = 1; i < w.pickups.capacity; i++) spawnPickup(w, 0, 0, 1);
    expect(spawnPickup(w, 0, 0, 1)).toBeNull();
  });

  it('grantShards clamps to the wallet max and ignores absent players', () => {
    const w = createTestWorld({ mode: 'solo' });
    w.run.wallets[0] = ECONOMY.WALLET_MAX - 3;
    expect(grantShards(w, 0, 10)).toBe(3);
    expect(w.run.wallets[0]).toBe(ECONOMY.WALLET_MAX);
    expect(w.run.shardsEarned[0]).toBe(3);
    expect(grantShards(w, 1, 10)).toBe(0);
    expect(grantShards(w, 0, 0)).toBe(0);
  });

  it('magnet pulls pickups in and the collector gets the value (+shardGain, combo bonus)', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 0);
    w.players[0].stats.shardGain = 1.2;
    addTestPickup(w, 3, 0, 5);
    stepSystem(w, stepPickups, 30);
    expect(w.pickups.count).toBe(0);
    expect(w.run.wallets[0]).toBe(6);
    expect(w.events.pickup.count).toBe(1);
    w.players[0].comboTier = 4;
    expect(pickupValue(w, w.players[0], 10)).toBe(Math.round(10 * 1.2 * 1.4));
  });

  it('outside the magnet radius pickups slow down, blink and despawn at 12 s', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 0);
    const k = addTestPickup(w, 20, 0, 1);
    k.vx = 4;
    stepSystem(w, stepPickups, 60);
    expect(k.vx).toBeLessThan(1);
    stepSystem(w, stepPickups, PICKUPS.DESPAWN_AT * 120);
    expect(w.pickups.count).toBe(0);
    expect(w.run.wallets[0]).toBe(0);
  });

  it('catch-up: +20% when below 60% of the partner wallet', () => {
    const w = createTestWorld();
    w.run.wallets[0] = 10;
    w.run.wallets[1] = 100;
    expect(pickupValue(w, w.players[0], 25)).toBe(30);
    expect(pickupValue(w, w.players[1], 25)).toBe(25);
  });

  it('downed players do not collect', () => {
    const w = createTestWorld({ mode: 'solo' });
    w.players[0].life = 'downed';
    addTestPickup(w, 0, 0, 5);
    stepSystem(w, stepPickups, 10);
    expect(w.run.wallets[0]).toBe(0);
  });

  it('vacuum credits every pickup to the nearest living player, else any present', () => {
    const w = createTestWorld();
    placePlayer(w, 0, -10, 0);
    placePlayer(w, 1, 10, 0);
    addTestPickup(w, -9, 0, 5);
    addTestPickup(w, 9, 0, 25);
    vacuumPickups(w);
    expect(w.pickups.count).toBe(0);
    // P1 is below 60% of P2's wallet when the 5 lands: catch-up +20%.
    expect(w.run.wallets).toEqual([6, 25]);
    expect(w.events.pickup.count).toBe(2);
    w.players[1].life = 'downed';
    addTestPickup(w, 9, 0, 5);
    vacuumPickups(w);
    expect(w.run.wallets[0]).toBe(12);
    w.players[0].life = 'downed';
    addTestPickup(w, 9, 0, 1);
    vacuumPickups(w);
    expect(w.run.wallets[1]).toBe(26);
  });
});
