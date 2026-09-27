/**
 * Sim hot-path allocation (plan section 10 "zero steady-state GC", section 10.2 "ZERO ALLOCATION IN HOT PATHS";
 * approved decision 9 gates on zero steady-state allocation), measured with V8's sampling heap profiler so the
 * result does not depend on scavenge timing. The budgets include the inspector's own ~100 B/step.
 *
 * Regression targets (PERF-1): a call TurboFan does not inline boxes every fractional double argument and
 * return value into a HeapNumber, so the per-enemy / per-shot / per-hit paths pass targets, muzzles, sweeps and
 * damage through module Float64Array scratch (enemyBehaviors TGT, contentShared ENEMY_MUZZLE, collision SEG,
 * damage HIT_IN, cardEffects ARC, specials RAIL, weapons VOLLEY) instead of double parameters (was ~12 KB/step).
 *
 * Warm-up: "steady state" means every sim function has tiered up. Node 22 ships without Maglev, and TurboFan
 * needs ~3,000 invocations of a function; interpreted/baseline code boxes every double it computes. Functions
 * that run once per step (stepDrone, placeBeam, stepRules) or once per volley (fireVolley, fireSpikerRing) only
 * reach that after thousands of steps, so the whole-world test warms up for 20,000 steps (~167 s of play;
 * measured ~0.6 KB/step at 2,000-8,000 steps from those cold paths alone, ~50 B/step once warm).
 */
import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/config/tuning';
import { stepEnemies } from '../../src/entities/enemies';
import { clearSimEvents } from '../../src/sim/simEventChannels';
import { measureAllocation } from '../support/allocProbe';
import { createStressRig, STRESS_ENEMIES } from '../support/stressWorld';

/** Budget per 120 Hz step once warm (zero, with slack for sampling noise and incidental event structs). */
const STEP_BUDGET_BYTES = 256;
const ENEMY_SYSTEM_BUDGET_BYTES = 256;

describe('sim hot path allocation', () => {
  it('stepWorld at the stress load (180 enemies, ~2,000 shots) allocates ~nothing per step', async () => {
    const rig = createStressRig(true);
    const report = await measureAllocation(
      (i) => {
        rig.step();
        if ((i & 1) === 1) clearSimEvents(rig.w.events);
      },
      600,
      20_000,
    );
    if (report === null) return;
    expect(rig.w.enemies.count).toBe(STRESS_ENEMIES);
    expect(
      report.bytesPerIter,
      `stepWorld allocates ${Math.round(report.bytesPerIter)} B/step; top:\n${report.top.join('\n')}`,
    ).toBeLessThan(STEP_BUDGET_BYTES);
  }, 120_000);

  it('the enemies system (behaviours, steering, separation) allocates nothing per step', async () => {
    const rig = createStressRig(true);
    for (let i = 0; i < 60; i++) rig.step();
    clearSimEvents(rig.w.events);
    const w = rig.w;
    const intents = rig.prep();
    const report = await measureAllocation(
      (i) => {
        w.run.waveTimer = 60;
        stepEnemies(w, intents, SIM.DT);
        if ((i & 7) === 7) clearSimEvents(w.events);
      },
      1_000,
      3_000,
    );
    if (report === null) return;
    expect(w.enemies.count).toBe(STRESS_ENEMIES);
    expect(
      report.bytesPerIter,
      `stepEnemies allocates ${Math.round(report.bytesPerIter)} B/step for ${STRESS_ENEMIES} enemies; top:\n${report.top.join('\n')}`,
    ).toBeLessThan(ENEMY_SYSTEM_BUDGET_BYTES);
  }, 60_000);
});
