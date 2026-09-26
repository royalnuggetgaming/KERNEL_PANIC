import { describe, expect, it } from 'vitest';
import { GOVERNOR, QUALITY_PRESETS } from '../../src/config/quality';
import { createMemoryLogger } from '../../src/core/logger';
import { createPerfMonitor } from '../../src/engine/PerfMonitor';
import {
  createResolutionGovernor,
  type GovernorAction,
  type ResolutionGovernor,
} from '../../src/engine/ResolutionGovernor';

/** Evaluates every 0.1 s from t0 for `seconds` with a p95 source; returns the non-null actions. */
function run(
  g: ResolutionGovernor,
  t0: number,
  seconds: number,
  p95: (t: number, i: number) => number,
  playing = true,
): GovernorAction[] {
  const out: GovernorAction[] = [];
  const n = Math.round(seconds * 10);
  for (let i = 0; i < n; i++) {
    const t = t0 + i / 10;
    const a = g.evaluate(t, p95(t, i), playing);
    if (a !== null) out.push(a);
  }
  return out;
}

describe('ResolutionGovernor', () => {
  it('steps down the full ladder (scale, MSAA, 60 cap) one step per 2 s under sustained load', () => {
    const g = createResolutionGovernor(QUALITY_PRESETS.high);
    expect(g.maxStep).toBe(5);
    const acts = run(g, 0, 20, () => 22);
    expect(acts).toEqual([
      { kind: 'renderScale', value: 0.85 },
      { kind: 'renderScale', value: 0.72 },
      { kind: 'renderScale', value: 0.6 },
      { kind: 'msaa', value: 2 },
      { kind: 'frameCap', value: 60 },
    ]);
    expect(g.step).toBe(5);
  });

  it('needs STEP_DOWN_AFTER_S of sustained load and MIN_STEP_INTERVAL_S between steps', () => {
    const g = createResolutionGovernor(QUALITY_PRESETS.high);
    expect(g.evaluate(0, 30, true)).toBeNull();
    expect(g.evaluate(GOVERNOR.STEP_DOWN_AFTER_S - 0.01, 30, true)).toBeNull();
    expect(g.evaluate(GOVERNOR.STEP_DOWN_AFTER_S, 30, true)).toEqual({ kind: 'renderScale', value: 0.85 });
    expect(g.evaluate(GOVERNOR.STEP_DOWN_AFTER_S + 1.5, 30, true)).toBeNull();
    expect(g.evaluate(GOVERNOR.STEP_DOWN_AFTER_S + GOVERNOR.MIN_STEP_INTERVAL_S, 30, true)).toEqual({
      kind: 'renderScale',
      value: 0.72,
    });
  });

  it('steps down on 5% missed frames measured by PerfMonitor, not on 3%', () => {
    for (const [missPct, expectStep] of [
      [6, true],
      [3, false],
    ] as const) {
      const m = createPerfMonitor({ log: createMemoryLogger() });
      for (let i = 0; i < 600; i++)
        m.record({
          frameMs: i % 100 < missPct ? 25 : 1000 / 120,
          simMs: 0.5,
          cpuMs: 2,
          steps: 1,
          dropped: 0,
        });
      const g = createResolutionGovernor(QUALITY_PRESETS.high);
      const acts = run(g, 0, 1.5, () => m.percentile('frame', 95));
      expect(acts.length > 0).toBe(expectStep);
    }
  });

  it('steps back up in reverse order after 10 s clean', () => {
    const g = createResolutionGovernor(QUALITY_PRESETS.high);
    run(g, 0, 4, () => 22);
    expect(g.step).toBe(2);
    const early = run(g, 4, GOVERNOR.STEP_UP_AFTER_S - 0.2, () => 8);
    expect(early).toEqual([]);
    const ups = run(g, 4 + GOVERNOR.STEP_UP_AFTER_S - 0.2, 30, () => 8);
    expect(ups).toEqual([
      { kind: 'renderScale', value: 0.85 },
      { kind: 'renderScale', value: 1 },
    ]);
    expect(g.step).toBe(0);
    expect(run(g, 60, 30, () => 8)).toEqual([]);
  });

  it('restores MSAA and uncaps on the way up', () => {
    const g = createResolutionGovernor(QUALITY_PRESETS.ultra);
    run(g, 0, 20, () => 30);
    const ups = run(g, 20, 25, () => 5);
    expect(ups.slice(0, 2)).toEqual([
      { kind: 'frameCap', value: null },
      { kind: 'msaa', value: 4 },
    ]);
  });

  it('does not oscillate under alternating load', () => {
    const g = createResolutionGovernor(QUALITY_PRESETS.high);
    expect(run(g, 0, 120, (_t, i) => (i % 2 === 0 ? 24 : 8))).toEqual([]);
    expect(run(g, 200, 120, (t) => (Math.floor(t / 0.5) % 2 === 0 ? 24 : 8))).toEqual([]);
    // Hovering inside the hysteresis band neither steps down nor counts as clean.
    run(g, 400, 3, () => 20);
    const s = g.step;
    expect(run(g, 403, 60, () => 15.5)).toEqual([]);
    expect(g.step).toBe(s);
  });

  it('evaluates only while playing, and pausing restarts the timers', () => {
    const g = createResolutionGovernor(QUALITY_PRESETS.high);
    expect(run(g, 0, 10, () => 40, false)).toEqual([]);
    g.evaluate(10, 40, true);
    g.evaluate(10.5, 40, false);
    expect(g.evaluate(11.2, 40, true)).toBeNull();
    expect(g.evaluate(12.2, 40, true)).not.toBeNull();
  });

  it('skips the MSAA rung for presets without 4x MSAA and reset() returns to step 0', () => {
    for (const preset of [QUALITY_PRESETS.low, QUALITY_PRESETS.medium]) {
      const g = createResolutionGovernor(preset);
      expect(g.maxStep).toBe(4);
      const acts = run(g, 0, 20, () => 25);
      expect(acts.map((a) => a.kind)).toEqual(['renderScale', 'renderScale', 'renderScale', 'frameCap']);
      g.reset(QUALITY_PRESETS.high);
      expect(g.step).toBe(0);
      expect(g.maxStep).toBe(5);
      expect(g.evaluate(100, 25, true)).toBeNull();
    }
  });
});
