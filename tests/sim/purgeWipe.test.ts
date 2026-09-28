/**
 * Regression (critic v2): checkWipe only runs in 'combat' and 'boss'. When the wave timer expires inside the 1 s wipe grace,
 * startPurge resets wipeGrace, the purge/outro never check for a wipe and finishWave reboots the whole team:
 * a full team wipe with no Spare Kernels is turned into a wave clear.
 */
import { expect, it } from 'vitest';
import { createIntents } from '../helpers/scriptedIntents';
import { addTestEnemy } from '../helpers/worldFixture';
import { newSession } from './runDriver';

it('a team wipe just before the wave timer ends is still a defeat', () => {
  const s = newSession('coop', 9);
  s.beginNextWave();
  const w = s.state;
  const idle = createIntents();
  w.run.phase = 'combat';
  w.run.phaseTimer = 0;
  w.run.waveTimer = 0.3; // expires inside the 1 s wipe grace
  w.director.budgetLeft = 0;
  w.director.pending.clear();
  w.run.spareKernels = 0;
  addTestEnemy(w, 'warden', 25, 0); // a survivor keeps the wave from clearing on its own
  for (const p of w.players) {
    p.life = 'downed';
    p.hp = 0;
    p.bleedLeft = 10;
    p.downedAt = w.time;
  }
  w.players[0].x = -20;
  w.players[1].x = 20;
  let defeat = false;
  for (let t = 0; t < 120 * 6 && !s.flags.waveClearReady; t++) {
    s.tick(idle);
    s.clearEvents();
    if (s.flags.defeat) {
      defeat = true;
      break;
    }
  }
  expect(s.flags.waveClearReady).toBe(false);
  expect(defeat).toBe(true);
});
