/**
 * Regression tests (W2-SIM): W1-COMBAT keeps sync-kill and Bulwark-ram bookkeeping in per-world memory outside
 * the world object. A world recycled by resetWorld (tick/time back to 0) must not inherit it.
 */
import { describe, expect, it } from 'vitest';
import { lastSyncTime, registerKill } from '../../src/entities/combo';
import { beginRam, ramStamps, stepRam } from '../../src/entities/playerDash';
import { resetWorld } from '../../src/sim/createWorld';
import type { WorldState } from '../../src/contracts/world';
import { addTestEnemy, createTestWorld, placePlayer, testWorldConfig } from '../helpers/worldFixture';

function setClock(w: WorldState, tick: number): void {
  w.tick = tick;
  w.time = tick / 120;
}

describe('per-world combat memory', () => {
  it('sync kills work again after resetWorld (stale last-sync time is dropped)', () => {
    const w = createTestWorld({ mode: 'coop' });
    setClock(w, 12_000);
    w.players[1].lastKillTime = w.time - 0.1;
    registerKill(w, 0, 0, 0, 10);
    expect(lastSyncTime(w)).toBeCloseTo(100, 6);
    expect(w.run.wallets).toEqual([2, 2]);

    resetWorld(w, testWorldConfig({ mode: 'coop', seed: 2 }));
    expect(lastSyncTime(w)).toBe(-1);
    setClock(w, 24);
    w.players[1].lastKillTime = w.time - 0.1;
    registerKill(w, 0, 0, 0, 10);
    expect(w.run.wallets).toEqual([2, 2]);
    expect(lastSyncTime(w)).toBeCloseTo(0.2, 6);
  });

  it('a new world with the same clock never sees another world sync memory', () => {
    const a = createTestWorld({ mode: 'coop' });
    setClock(a, 600);
    a.players[1].lastKillTime = a.time;
    registerKill(a, 0, 0, 0, 10);
    const b = createTestWorld({ mode: 'coop' });
    expect(lastSyncTime(b)).toBe(-1);
  });

  it('Bulwark ram hits again after resetWorld at the same tick and slot', () => {
    const w = createTestWorld({ mode: 'coop', vehicles: ['lancer', 'bulwark'] });
    setClock(w, 10);
    placePlayer(w, 1, 0, 0);
    const e1 = addTestEnemy(w, 'warden', 0.5, 0, { hp: 1000, maxHp: 1000 });
    beginRam(w, 1);
    stepRam(w, w.players[1]);
    expect(e1.hp).toBeLessThan(1000);
    expect(ramStamps(w)).not.toBeNull();

    resetWorld(w, testWorldConfig({ mode: 'coop', vehicles: ['lancer', 'bulwark'], seed: 3 }));
    expect(ramStamps(w)).toBeNull();
    setClock(w, 10);
    placePlayer(w, 1, 0, 0);
    const e2 = addTestEnemy(w, 'warden', 0.5, 0, { hp: 1000, maxHp: 1000 });
    expect(e2.slot).toBe(e1.slot);
    beginRam(w, 1);
    stepRam(w, w.players[1]);
    expect(e2.hp).toBeLessThan(1000);
  });

  it('rams each enemy once per dash within a run', () => {
    const w = createTestWorld({ mode: 'coop', vehicles: ['lancer', 'bulwark'] });
    setClock(w, 5);
    placePlayer(w, 1, 0, 0);
    const e = addTestEnemy(w, 'warden', 0.5, 0, { hp: 1000, maxHp: 1000 });
    beginRam(w, 1);
    stepRam(w, w.players[1]);
    const after = e.hp;
    setClock(w, 6);
    stepRam(w, w.players[1]);
    expect(e.hp).toBe(after);
  });
});
