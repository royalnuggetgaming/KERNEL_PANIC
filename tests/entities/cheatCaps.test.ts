import { describe, expect, it } from 'vitest';
import type { CheatId } from '../../src/contracts/ids';
import { SIM, STAT_CAPS } from '../../src/config/tuning';
import { NullLogger } from '../../src/core/logger';
import { stepWeapons } from '../../src/entities/weapons';
import { createRunSession } from '../../src/sim/RunSession';
import { testRunConfig } from '../helpers/fakeRun';
import { createIntents } from '../helpers/scriptedIntents';
import { stepSystem } from '../helpers/worldFixture';

function soloRun(cheats: readonly CheatId[]) {
  return createRunSession(
    testRunConfig({ mode: 'solo', players: [{ player: 0, vehicle: 'lancer' }], cheats }),
    { log: NullLogger },
  );
}

function fireOneSecond(cheats: readonly CheatId[]) {
  const run = soloRun(cheats);
  const w = run.state;
  const it = createIntents();
  it[0].fireHeld = true;
  w.players[0].fireAcc = 0;
  stepSystem(w, stepWeapons, SIM.HZ, it);
  let maxDamage = 0;
  for (let i = 0; i < w.playerShots.count; i++) {
    const d = w.playerShots.active[i]!.damage;
    if (d > maxDamage) maxDamage = d;
  }
  const out = { shots: w.playerShots.count, maxDamage, stats: { ...w.players[0].stats } };
  run.dispose();
  return out;
}

// Regression: the sim clamped fire rate, damage, bullets and dash charges to the default STAT_CAPS, so the
// raised caps of TURBO / GLASS CANNON / BULLET STORM / BLINK BLINK only showed in the stats, not in play.
describe('cheat runs: the sim honours cheat-raised hard caps', () => {
  it('GLASS CANNON fires x5 damage (above the normal 4.0 damage cap)', () => {
    const plain = fireOneSecond([]);
    const glass = fireOneSecond(['glassCannon']);
    expect(glass.stats.damageMul).toBeGreaterThan(STAT_CAPS.damageMulMax);
    expect(glass.maxDamage).toBeCloseTo(plain.maxDamage * 5, 5);
  });

  it('TURBO doubles the volleys per second, even above the normal 20/s cap (with the Mythic card)', () => {
    expect(fireOneSecond(['turbo']).shots).toBe(fireOneSecond([]).shots * 2);
    const plain = fireOneSecond(['mythicStart']);
    const turbo = fireOneSecond(['turbo', 'mythicStart']);
    expect(turbo.stats.fireRate).toBeGreaterThan(STAT_CAPS.fireRateMax);
    expect(turbo.shots).toBe(plain.shots * 2);
  });

  it('BULLET STORM fires +4 bullets per volley', () => {
    const plain = fireOneSecond([]);
    const storm = fireOneSecond(['bulletStorm']);
    expect(storm.shots).toBe(plain.shots * (1 + 4));
  });

  it('BLINK BLINK spawns with every dash charge its stats promise; normal runs keep the cap', () => {
    const blink = soloRun(['blinkBlink']);
    const p = blink.state.players[0];
    expect(p.stats.dashCharges).toBeGreaterThan(STAT_CAPS.dashChargesMax);
    expect(p.dashCharges).toBe(p.stats.dashCharges);
    blink.dispose();
    const plain = soloRun([]);
    expect(plain.state.config.caps).toBeUndefined();
    expect(plain.state.players[0].dashCharges).toBe(plain.state.players[0].stats.dashCharges);
    plain.dispose();
  });

  it('a normal run keeps the default caps (fire-rate overflow still converts to damage, capped at 4.0)', () => {
    const run = soloRun([]);
    const w = run.state;
    w.players[0].stats.fireRate = 240;
    w.players[0].stats.damageMul = 10;
    const it = createIntents();
    it[0].fireHeld = true;
    stepSystem(w, stepWeapons, SIM.HZ, it);
    expect(w.playerShots.count).toBe(STAT_CAPS.fireRateMax);
    run.dispose();
  });
});
