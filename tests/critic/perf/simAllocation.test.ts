/**
 * PERF critic (plan section 10 "zero steady-state GC", section 10.2 "ZERO ALLOCATION IN HOT PATHS"; approved
 * decision 9 gates on zero steady-state allocation). Measured with V8's sampling heap profiler, so the result does
 * not depend on scavenge timing. tests/sim/perf.test.ts only bounds this at 32 KB/step and documents ~12 KB/step
 * as acceptable boxing; the plan budget is zero. Expected to FAIL on the current code:
 * - stepEnemies: every non-inlined call in enemyBehaviors that passes or returns a freshly computed double
 *   (stepDart/stepSpiker/stepWarden/stepLeech(tx, tz, dist), stepSeek(tx, tz), turnToward -> angleDiff /
 *   wrapAngle) allocates a HeapNumber: ~10 KB per step at 180 enemies (~40 B per enemy per step).
 * - collision: applyShotHit -> applyDamage/applyBossDamage/chainArcOnHit(x, z, damage) and findFirstHit ->
 *   segCircleHit box their double arguments/results: 0.5-4.4 KB per step.
 */
import { describe, expect, it } from 'vitest';
import { SIM } from '../../../src/config/tuning';
import { stepEnemies } from '../../../src/entities/enemies';
import { clearSimEvents } from '../../../src/sim/simEventChannels';
import { measureAllocation } from '../../support/allocProbe';
import { createStressRig, STRESS_ENEMIES } from '../../support/stressWorld';

/** Budget per 120 Hz step once warm (zero, with slack for sampling noise and incidental event structs). */
const STEP_BUDGET_BYTES = 256;
const ENEMY_SYSTEM_BUDGET_BYTES = 256;

describe('PERF critic: sim hot path allocation', () => {
  it('stepWorld at the stress load (180 enemies, ~2,000 shots) allocates ~nothing per step', async () => {
    const rig = createStressRig(true);
    const report = await measureAllocation(
      (i) => {
        rig.step();
        if ((i & 1) === 1) clearSimEvents(rig.w.events);
      },
      600,
      2_000,
    );
    if (report === null) return;
    expect(rig.w.enemies.count).toBe(STRESS_ENEMIES);
    expect(
      report.bytesPerIter,
      `stepWorld allocates ${Math.round(report.bytesPerIter)} B/step; top:\n${report.top.join('\n')}`,
    ).toBeLessThan(STEP_BUDGET_BYTES);
  }, 60_000);

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
