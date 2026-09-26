/**
 * Determinism (plan section 11): the same seed and 7,200 scripted steps give an identical stateHash trace; a
 * different seed differs. Also: a world recycled by resetWorld replays exactly like a fresh one (including
 * W1-COMBAT's per-world sync/ram memory), and stateHash itself is pure.
 */
import { describe, expect, it } from 'vitest';
import type { RunMode } from '../../src/contracts/ids';
import type { Intents } from '../../src/contracts/input';
import type { WorldState } from '../../src/contracts/world';
import { SIM } from '../../src/config/tuning';
import { lastSyncTime, registerKill } from '../../src/entities/combo';
import { beginRam, ramStamps, stepRam } from '../../src/entities/playerDash';
import { createWorld, resetWorld } from '../../src/sim/createWorld';
import { beginWave } from '../../src/sim/rules';
import { stateHash } from '../../src/sim/stateHash';
import { stepWorld } from '../../src/sim/stepWorld';
import { ScriptedIntents } from '../helpers/scriptedIntents';
import { addTestEnemy, placePlayer, testWorldConfig } from '../helpers/worldFixture';
import { Autopilot } from './autopilot';
import { hashTrace, newSession } from './runDriver';

const STEPS = 7_200;

function trace(mode: RunMode, seed: number, pilot: 'autopilot' | 'random'): number[] {
  const s = newSession(mode, seed);
  s.beginNextWave();
  const ap = new Autopilot();
  const si = new ScriptedIntents('random', seed);
  let tick = 0;
  const intents = (w: WorldState): Intents => (pilot === 'autopilot' ? ap.at(w) : si.at(tick++));
  return hashTrace(s, STEPS, 600, intents);
}

describe('determinism', () => {
  for (const mode of ['solo', 'coop', 'versus'] as const) {
    it(`${mode}: same seed + ${STEPS} steps -> identical stateHash trace`, () => {
      const a = trace(mode, 1234, 'autopilot');
      const b = trace(mode, 1234, 'autopilot');
      expect(a.length).toBeGreaterThan(5);
      expect(b).toEqual(a);
    }, 60_000);
  }

  it('random scripted intents replay identically', () => {
    expect(trace('coop', 99, 'random')).toEqual(trace('coop', 99, 'random'));
  }, 60_000);

  it('a different seed gives a different hash', () => {
    const a = trace('coop', 1234, 'autopilot');
    const b = trace('coop', 1235, 'autopilot');
    expect(b[b.length - 1]).not.toBe(a[a.length - 1]);
    expect(b).not.toEqual(a);
  }, 60_000);

  it('a world recycled by resetWorld replays exactly like a fresh world (incl. combat memory)', () => {
    const cfg = testWorldConfig({ seed: 77, mode: 'coop', vehicles: ['lancer', 'bulwark'] });
    const run = (w: WorldState): number[] => {
      const si = new ScriptedIntents('kite', 5);
      beginWave(w, 1);
      const out: number[] = [];
      for (let t = 0; t < 3_600; t++) {
        stepWorld(w, si.at(t), SIM.DT);
        if (t % 300 === 299) out.push(stateHash(w));
      }
      return out;
    };
    const fresh = run(createWorld(cfg));

    // Dirty a world's per-world combat memory (a sync kill and a Bulwark ram late in a run) while leaving its
    // pools in canonical slot order: EntityPool.clear() does not restore the fresh free-slot order, so a world
    // that spawned several entities is deterministic but not slot-identical to a fresh one (see report).
    const recycled = createWorld(testWorldConfig({ seed: 5, mode: 'coop', vehicles: ['lancer', 'bulwark'] }));
    recycled.tick = 90_000;
    recycled.time = recycled.tick * SIM.DT;
    recycled.players[1].lastKillTime = recycled.time - 0.1;
    registerKill(recycled, 0, 0, 0, 10);
    placePlayer(recycled, 1, 0, 0);
    addTestEnemy(recycled, 'warden', 0.5, 0, { hp: 1e6, maxHp: 1e6 });
    beginRam(recycled, 1);
    stepRam(recycled, recycled.players[1]);
    expect(lastSyncTime(recycled)).toBeGreaterThan(0);
    expect(ramStamps(recycled)).not.toBeNull();
    resetWorld(recycled, cfg);
    expect(lastSyncTime(recycled)).toBe(-1);
    expect(ramStamps(recycled)).toBeNull();
    expect(run(recycled)).toEqual(fresh);
  }, 60_000);

  it('stateHash is pure and sensitive to positions, hp, wallets and rng', () => {
    const w = createWorld(testWorldConfig({ seed: 3 }));
    const h = stateHash(w);
    expect(stateHash(w)).toBe(h);
    w.players[0].x += 1e-9;
    const h1 = stateHash(w);
    expect(h1).not.toBe(h);
    w.players[1].hp -= 1;
    const h2 = stateHash(w);
    expect(h2).not.toBe(h1);
    w.run.wallets[0] += 1;
    const h3 = stateHash(w);
    expect(h3).not.toBe(h2);
    w.rng.sim.next();
    expect(stateHash(w)).not.toBe(h3);
  });
});
