import { describe, expect, it } from 'vitest';
import { SOURCE_WORLD } from '../../src/contracts/simEvents';
import { COOP, SIM } from '../../src/config/tuning';
import { damagePlayer } from '../../src/entities/damage';
import { stepPickups } from '../../src/entities/pickups';
import { livingPlayerCount, rebootAtWaveEnd, stepRevive } from '../../src/entities/revive';
import {
  addTestEnemy,
  addTestPickup,
  createTestWorld,
  placePlayer,
  stepSystem,
} from '../helpers/worldFixture';

type W = ReturnType<typeof createTestWorld>;

function down(w: W, i: 0 | 1): void {
  damagePlayer(w, w.players[i], 10_000, SOURCE_WORLD, 0, 0, 'projectile');
}

function events(w: W, what: string): number {
  let n = 0;
  for (let i = 0; i < w.events.player.count; i++) if (w.events.player.get(i).what === what) n++;
  return n;
}

const TICKS_PER_S = SIM.HZ;

describe('revive', () => {
  it('needs 2.0 s cumulative within 2.5 u; progress decays at 50%/s while away', () => {
    const w = createTestWorld({ startKernels: 0 });
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 1, 0);
    down(w, 0);
    stepSystem(w, stepRevive, TICKS_PER_S); // 1.0 s near
    expect(w.players[0].reviveProgress).toBeCloseTo(0.5, 6);
    placePlayer(w, 1, 10, 0);
    stepSystem(w, stepRevive, TICKS_PER_S / 2); // 0.5 s away: -0.25
    expect(w.players[0].reviveProgress).toBeCloseTo(0.25, 6);
    placePlayer(w, 1, 2, 0);
    stepSystem(w, stepRevive, TICKS_PER_S * 1.5 - 1);
    expect(w.players[0].life).toBe('downed');
    stepSystem(w, stepRevive, 2);
    const p = w.players[0];
    expect(p.life).toBe('alive');
    expect(p.hp).toBe(40);
    expect(p.invulnUntil).toBeCloseTo(w.time + COOP.REVIVE_INVULN, 1);
    expect(w.players[1].revives).toBe(1);
    expect(events(w, 'revived')).toBe(1);
  });

  it('Revive Protocol stats shorten the revive and raise the hp', () => {
    const w = createTestWorld({ startKernels: 0 });
    placePlayer(w, 1, 1, 0);
    placePlayer(w, 0, 0, 0);
    w.players[0].stats.reviveTime = 1.2;
    w.players[0].stats.reviveHpFrac = 0.6;
    down(w, 0);
    stepSystem(w, stepRevive, Math.ceil(TICKS_PER_S * 1.2) + 1);
    expect(w.players[0].life).toBe('alive');
    expect(w.players[0].hp).toBe(60);
  });

  it('bleed-out 12 s, then a Spare Kernel respawns beside the partner after 1.5 s at 60%', () => {
    const w = createTestWorld({ startKernels: 1 });
    placePlayer(w, 1, 20, 0);
    down(w, 0);
    stepSystem(w, stepRevive, COOP.BLEED_OUT * TICKS_PER_S - 2);
    expect(w.players[0].life).toBe('downed');
    stepSystem(w, stepRevive, 3);
    expect(w.players[0].life).toBe('respawning');
    expect(w.run.spareKernels).toBe(0);
    expect(events(w, 'kernel')).toBe(1);
    expect(livingPlayerCount(w)).toBe(2);
    stepSystem(w, stepRevive, COOP.KERNEL_RESPAWN_DELAY * TICKS_PER_S + 1);
    const p = w.players[0];
    expect(p.life).toBe('alive');
    expect(p.hp).toBe(60);
    expect(Math.hypot(p.x - 20, p.z)).toBeLessThan(3);
  });

  it('without kernels the player goes Offline; the ghost marks enemies and collects at 50%', () => {
    const w = createTestWorld({ startKernels: 0 });
    placePlayer(w, 1, 20, 0);
    down(w, 0);
    stepSystem(w, stepRevive, COOP.BLEED_OUT * TICKS_PER_S + 1);
    const p = w.players[0];
    expect(p.life).toBe('offline');
    expect(events(w, 'offline')).toBe(1);
    expect(livingPlayerCount(w)).toBe(1);
    const e = addTestEnemy(w, 'shard', p.x + 0.5, p.z);
    stepSystem(w, stepRevive, 1);
    expect(e.markedUntil).toBeGreaterThan(w.time);
    addTestPickup(w, p.x, p.z, 10);
    stepSystem(w, stepPickups, 1);
    expect(w.run.wallets[0]).toBe(5);
  });

  it('repeat downs in a wave shrink bleed-out to a 6 s floor', () => {
    const w = createTestWorld({ startKernels: 0 });
    const p = w.players[0];
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      p.life = 'alive';
      p.hp = 1;
      down(w, 0);
      seen.push(p.bleedLeft);
    }
    expect(seen).toEqual([12, 10, 8, 6, 6]);
  });

  it('no living player: a held kernel is spent immediately on the player downed longest', () => {
    const w = createTestWorld({ startKernels: 1 });
    w.time = 1;
    down(w, 1);
    w.time = 2;
    down(w, 0);
    expect(livingPlayerCount(w)).toBe(0);
    stepSystem(w, stepRevive, 1);
    expect(w.players[1].life).toBe('respawning');
    expect(w.players[0].life).toBe('downed');
    expect(w.run.spareKernels).toBe(0);
  });

  it('solo: downed spends a kernel at once, else stays downed for the wipe rule', () => {
    const w = createTestWorld({ mode: 'solo', startKernels: 1 });
    down(w, 0);
    stepSystem(w, stepRevive, 1);
    expect(w.players[0].life).toBe('respawning');
    stepSystem(w, stepRevive, COOP.KERNEL_RESPAWN_DELAY * TICKS_PER_S + 1);
    expect(w.players[0].life).toBe('alive');
    w.players[0].invulnUntil = 0;
    down(w, 0);
    stepSystem(w, stepRevive, 1);
    expect(w.players[0].life).toBe('downed');
    expect(livingPlayerCount(w)).toBe(0);
  });

  it('wave-end reboot: Downed -> 40%, Offline -> 30%, resets the down counter', () => {
    const w = createTestWorld({ startKernels: 0 });
    down(w, 0);
    down(w, 1);
    w.players[1].life = 'offline';
    rebootAtWaveEnd(w);
    expect(w.players[0].life).toBe('alive');
    expect(w.players[0].hp).toBe(40);
    expect(w.players[1].life).toBe('alive');
    expect(w.players[1].hp).toBe(45);
    expect(w.players[0].downsThisWave).toBe(0);
    expect(events(w, 'reboot')).toBe(2);
  });

  it('versus: stepRevive and the reboot are no-ops', () => {
    const w = createTestWorld({ mode: 'versus' });
    down(w, 0);
    stepSystem(w, stepRevive, 20 * TICKS_PER_S);
    expect(w.players[0].life).toBe('downed');
    rebootAtWaveEnd(w);
    expect(w.players[0].life).toBe('downed');
  });
});
