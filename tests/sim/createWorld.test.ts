import { describe, expect, it } from 'vitest';
import { CAPACITY } from '../../src/config/tuning';
import { VERSUS } from '../../src/config/versus';
import { createWorld, resetWorld } from '../../src/sim/createWorld';
import {
  addTestEnemy,
  addTestPickup,
  addTestPlayerShot,
  createTestWorld,
  testWorldConfig,
} from '../helpers/worldFixture';

describe('createWorld / resetWorld', () => {
  it('allocates pools at capacity with 2 player slots', () => {
    const w = createTestWorld();
    expect(w.enemies.capacity).toBe(CAPACITY.enemies);
    expect(w.playerShots.capacity).toBe(CAPACITY.playerShots);
    expect(w.enemyShots.capacity).toBe(CAPACITY.enemyShots);
    expect(w.pickups.capacity).toBe(CAPACITY.pickups);
    expect(w.bosses).toHaveLength(CAPACITY.bossParts);
    expect(w.players[0].life).toBe('alive');
    expect(w.players[1].life).toBe('alive');
    expect(w.players[1].vehicle).toBe('bulwark');
    expect(w.players[1].hp).toBe(150);
    expect(w.run.playerCount).toBe(2);
    expect(w.run.spareKernels).toBe(1);
    expect(w.run.phase).toBe('idle');
  });

  it('solo marks P2 absent; versus mirrors spawns and has no kernels', () => {
    const solo = createTestWorld({ mode: 'solo' });
    expect(solo.players[1].life).toBe('absent');
    expect(solo.run.playerCount).toBe(1);
    expect(solo.run.wallets[1]).toBe(0);
    const vs = createTestWorld({ mode: 'versus', startShards: 25 });
    expect(vs.players[0].x).toBe(-VERSUS.SPAWN_OFFSET);
    expect(vs.players[1].x).toBe(VERSUS.SPAWN_OFFSET);
    expect(vs.run.spareKernels).toBe(0);
    expect(vs.run.wallets).toEqual([25, 25]);
    expect(vs.run.roundWinner).toBe(-2);
  });

  it('rejects inconsistent configs', () => {
    const cfg = testWorldConfig({ mode: 'coop' });
    expect(() => createWorld({ ...cfg, mode: 'solo' })).toThrow();
    expect(() => createWorld({ ...cfg, startShards: -1 })).toThrow();
  });

  it('same seed gives the same rng streams', () => {
    const a = createTestWorld({ seed: 9 });
    const b = createTestWorld({ seed: 9 });
    const c = createTestWorld({ seed: 10 });
    const x = a.rng.sim.nextU32();
    expect(b.rng.sim.nextU32()).toBe(x);
    expect(c.rng.sim.nextU32()).not.toBe(x);
    expect(a.rng.shop.nextU32()).not.toBe(x);
  });

  it('resetWorld reuses allocations and clears state', () => {
    const w = createTestWorld({ seed: 3 });
    const pool = w.enemies;
    const players = w.players;
    addTestEnemy(w, 'shard', 1, 1);
    addTestPlayerShot(w, 0, 0, 0, 0, 10);
    addTestPickup(w, 2, 2, 5);
    w.events.kill.push();
    w.run.wave = 7;
    w.flags.defeat = true;
    w.players[0].score = 500;
    w.tick = 99;
    resetWorld(w, testWorldConfig({ seed: 4, mode: 'solo' }));
    expect(w.enemies).toBe(pool);
    expect(w.players).toBe(players);
    expect(w.enemies.count + w.playerShots.count + w.pickups.count).toBe(0);
    expect(w.events.kill.count).toBe(0);
    expect(w.run.wave).toBe(0);
    expect(w.flags.defeat).toBe(false);
    expect(w.players[0].score).toBe(0);
    expect(w.players[1].life).toBe('absent');
    expect(w.mode).toBe('solo');
    expect(w.tick).toBe(0);
    const fresh = createTestWorld({ seed: 4, mode: 'solo' });
    expect(w.rng.sim.nextU32()).toBe(fresh.rng.sim.nextU32());
  });
});
