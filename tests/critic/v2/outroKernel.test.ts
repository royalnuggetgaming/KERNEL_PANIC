/**
 * Critic v2: stepRevive keeps bleeding Downed players out during the wave-clear outro (2 s, slow-mo) although
 * the wave is already won and finishWave's reboot would revive them for free. A player downed shortly before the
 * last kill burns a Spare Kernel (150 Shards in the shop) or goes Offline (30% instead of 40% reboot HP).
 */
import { expect, it } from 'vitest';
import { createIntents } from '../../helpers/scriptedIntents';
import { newSession } from '../../sim/runDriver';

it('a Downed player does not spend a Spare Kernel during the wave-clear outro', () => {
  const s = newSession('coop', 5);
  s.beginNextWave();
  const w = s.state;
  const idle = createIntents();
  // Skip the countdown and the spawns: an empty arena with the budget spent clears the wave on the next tick.
  w.run.phase = 'combat';
  w.run.phaseTimer = 0;
  w.director.budgetLeft = 0;
  w.director.pending.clear();
  const p1 = w.players[1];
  p1.life = 'downed';
  p1.hp = 0;
  p1.bleedLeft = 0.5; // bleeds out 0.5 s into the 2 s outro
  p1.downedAt = w.time;
  p1.x = 20; // partner far away: no revive
  const kernelsBefore = w.run.spareKernels;
  expect(kernelsBefore).toBe(1);
  let sawOutro = false;
  for (let t = 0; t < 120 * 5 && !s.flags.waveClearReady; t++) {
    s.tick(idle);
    s.clearEvents();
    const phase: string = w.run.phase;
    if (phase === 'clearOutro') sawOutro = true;
  }
  expect(sawOutro).toBe(true);
  expect(s.flags.waveClearReady).toBe(true);
  expect(w.run.spareKernels).toBe(kernelsBefore);
});
