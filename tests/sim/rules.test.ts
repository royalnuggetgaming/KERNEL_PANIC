import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../src/contracts/world';
import { SIM } from '../../src/config/tuning';
import { WAVES, clearBonus } from '../../src/config/waves';
import { spawnEnemy } from '../../src/entities/enemies';
import { SLOWMO_SIM_TIME, beginWave, purgePayout, stepRules } from '../../src/sim/rules';
import { addTestEnemyShot, addTestPickup, createTestWorld, stepSystem } from '../helpers/worldFixture';

function secs(s: number): number {
  return Math.round(s / SIM.DT);
}

function inCombat(wave = 3, mode: 'coop' | 'solo' = 'coop'): WorldState {
  const w = createTestWorld({ mode });
  beginWave(w, wave);
  stepSystem(w, stepRules, secs(WAVES.COUNTDOWN) + 1);
  return w;
}

function waveEvents(w: WorldState, what: string): number {
  let n = 0;
  for (let i = 0; i < w.events.wave.count; i++) if (w.events.wave.get(i).what === what) n++;
  return n;
}

describe('beginWave + countdown', () => {
  it('fixes the wave numbers and runs a 3 s invulnerable countdown', () => {
    const w = createTestWorld();
    beginWave(w, 7);
    expect(w.run.wave).toBe(7);
    expect(w.run.sector).toBe(2);
    expect(w.run.overflow).toBe(false);
    expect(w.run.enemyHpMul).toBeCloseTo(Math.pow(1.07, 6) * 1.2, 12);
    expect(w.run.threatMul).toBe(1.5);
    expect(w.run.phase).toBe('countdown');
    expect(w.run.waveDuration).toBe(58);
    expect(w.director.budgetTotal).toBe(Math.round((30 + 98 + 1.8 * 49) * 1.5));
    expect(w.players[0].invulnUntil).toBeCloseTo(3, 9);
    stepSystem(w, stepRules, secs(3) - 1);
    expect(w.run.phase).toBe('countdown');
    expect(waveEvents(w, 'countdown')).toBe(3);
    stepSystem(w, stepRules, 2);
    expect(w.run.phase).toBe('combat');
    expect(waveEvents(w, 'start')).toBe(1);
  });

  it('boss waves enter the boss phase; OVERFLOW waves set the flag', () => {
    const w = createTestWorld();
    beginWave(w, 10);
    stepSystem(w, stepRules, secs(3) + 1);
    expect(w.run.phase).toBe('boss');
    beginWave(w, 16);
    expect(w.run.overflow).toBe(true);
    expect(w.run.sector).toBe(3);
  });

  it('is a no-op in versus', () => {
    const w = createTestWorld({ mode: 'versus' });
    w.run.phase = 'combat';
    w.run.waveTimer = 1;
    stepSystem(w, stepRules, 10);
    expect(w.run.waveTimer).toBe(1);
  });
});

describe('wave clear outro', () => {
  it('purges bullets, vacuums every pickup, pays the clear bonus and reboots before waveClearReady', () => {
    const w = inCombat(3);
    w.director.budgetLeft = 0;
    w.director.pending.clear();
    addTestEnemyShot(w, 5, 5, 1, 0);
    addTestPickup(w, 10, 10, 5);
    addTestPickup(w, -10, -10, 25);
    w.players[1].life = 'downed';
    w.players[1].hp = 0;
    stepSystem(w, stepRules, 1);
    expect(w.run.phase).toBe('clearOutro');
    expect(w.enemyShots.count).toBe(0);
    expect(w.pickups.count).toBe(0);
    expect(w.run.timeScaleRequest).toBe(WAVES.SLOWMO_SCALE);
    expect(w.players[0].invulnUntil).toBeGreaterThanOrEqual(w.time + WAVES.CLEAR_OUTRO - SIM.DT * 2);
    expect(waveEvents(w, 'cleared')).toBe(1);
    stepSystem(w, stepRules, secs(SLOWMO_SIM_TIME) + 1);
    expect(w.run.timeScaleRequest).toBe(1);
    expect(w.flags.waveClearReady).toBe(false);
    const wallet0 = w.run.wallets[0];
    const wallet1 = w.run.wallets[1];
    stepSystem(w, stepRules, secs(WAVES.CLEAR_OUTRO));
    expect(w.run.phase).toBe('done');
    expect(w.flags.waveClearReady).toBe(true);
    expect(w.run.wavesCleared).toBe(1);
    expect(w.run.wallets[0] - wallet0).toBe(clearBonus(3));
    expect(w.run.wallets[1] - wallet1).toBe(clearBonus(3));
    expect(w.players[1].life).toBe('alive');
    expect(w.players[1].hp).toBeGreaterThan(0);
  });

  it('offline players get 50% of the clear bonus', () => {
    const w = inCombat(4);
    w.director.budgetLeft = 0;
    w.players[1].life = 'offline';
    w.players[1].hp = 0;
    stepSystem(w, stepRules, secs(WAVES.CLEAR_OUTRO) + 2);
    expect(w.flags.waveClearReady).toBe(true);
    expect(w.run.wallets[0]).toBe(clearBonus(4));
    expect(w.run.wallets[1]).toBe(Math.floor(clearBonus(4) * 0.5));
  });

  it('clear beats wipe on the same tick', () => {
    const w = inCombat(3);
    w.director.budgetLeft = 0;
    w.players[0].life = 'downed';
    w.players[1].life = 'downed';
    stepSystem(w, stepRules, 1);
    expect(w.run.phase).toBe('clearOutro');
    expect(w.run.wipeGrace).toBe(-1);
    stepSystem(w, stepRules, secs(WAVES.CLEAR_OUTRO) + 2);
    expect(w.flags.defeat).toBe(false);
    expect(w.flags.waveClearReady).toBe(true);
  });

  it('wave 15 sets victory and the final visit', () => {
    const w = createTestWorld();
    beginWave(w, 15);
    w.run.phase = 'boss';
    w.director.bossSpawned = true;
    stepSystem(w, stepRules, secs(WAVES.CLEAR_OUTRO) + 2);
    expect(w.run.victoryAchieved).toBe(true);
    expect(w.flags.finalVisit).toBe(true);
    expect(w.flags.waveClearReady).toBe(true);
  });

  it('boss wave: adds left after the boss dies are purged first', () => {
    const w = createTestWorld();
    beginWave(w, 5);
    w.run.phase = 'boss';
    w.director.bossSpawned = true;
    spawnEnemy(w, 'shard', 0, -10, false, 0);
    stepSystem(w, stepRules, 1);
    expect(w.run.phase).toBe('purge');
  });
});

describe('purge', () => {
  it('de-rezzes survivors over 1.5 s paying 50% of their shards', () => {
    const w = inCombat(6);
    w.director.budgetLeft = 999;
    for (let i = 0; i < 12; i++) spawnEnemy(w, 'warden', i - 6, -15, i === 0, 0);
    w.run.waveTimer = SIM.DT / 2;
    stepSystem(w, stepRules, 1);
    expect(w.run.phase).toBe('purge');
    expect(w.director.budgetLeft).toBe(0);
    expect(waveEvents(w, 'purge')).toBe(1);
    stepSystem(w, stepRules, secs(0.75));
    expect(w.enemies.count).toBeGreaterThan(0);
    expect(w.enemies.count).toBeLessThan(12);
    stepSystem(w, stepRules, secs(0.75) + 1);
    expect(w.enemies.count).toBe(0);
    expect(w.run.phase).toBe('clearOutro');
    // Pickups were vacuumed into the wallets at outro start.
    const paid = w.run.wallets[0] + w.run.wallets[1];
    expect(paid).toBe(11 * purgePayout('warden', false) + purgePayout('warden', true));
    expect(purgePayout('warden', false)).toBe(2);
    expect(purgePayout('warden', true)).toBe(7);
    expect(purgePayout('shard', false)).toBe(0);
  });
});

describe('team wipe', () => {
  it('defeat after the 1.0 s grace with nobody alive', () => {
    const w = inCombat(3);
    w.director.budgetLeft = 50;
    w.players[0].life = 'downed';
    w.players[1].life = 'offline';
    stepSystem(w, stepRules, secs(1) - 2);
    expect(w.flags.defeat).toBe(false);
    expect(w.run.wipeGrace).toBeGreaterThan(0);
    stepSystem(w, stepRules, 3);
    expect(w.flags.defeat).toBe(true);
    expect(w.run.phase).toBe('done');
  });

  it('a kernel respawn during the grace cancels it', () => {
    const w = inCombat(3, 'solo');
    w.director.budgetLeft = 50;
    w.players[0].life = 'downed';
    stepSystem(w, stepRules, secs(0.5));
    w.players[0].life = 'respawning';
    stepSystem(w, stepRules, 1);
    expect(w.run.wipeGrace).toBe(-1);
    stepSystem(w, stepRules, secs(2));
    expect(w.flags.defeat).toBe(false);
  });
});
