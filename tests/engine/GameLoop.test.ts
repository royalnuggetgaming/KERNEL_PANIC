import { describe, expect, it } from 'vitest';
import { SIM } from '../../src/config/tuning';
import { createRng } from '../../src/core/rng';
import { createGameLoop, type FrameSample, type GameLoop, type LoopHooks } from '../../src/engine/GameLoop';
import type { FramePacer } from '../../src/engine/FramePacer';
import { FakeClock, FakeScheduler } from '../helpers/fakeClock';

interface LoopRig {
  readonly loop: GameLoop;
  readonly scheduler: FakeScheduler;
  readonly clock: FakeClock;
  readonly calls: string[];
  readonly samples: FrameSample[];
  readonly alphas: number[];
  readonly hooks: LoopHooks & { onApply: (() => void) | null; fixedCostMs: number };
  steps: number;
}

function createLoopRig(pacer: FramePacer | null = null, record = false): LoopRig {
  const scheduler = new FakeScheduler();
  const clock = new FakeClock(1000);
  const calls: string[] = [];
  const samples: FrameSample[] = [];
  const alphas: number[] = [];
  const rig = {
    scheduler,
    clock,
    calls,
    samples,
    alphas,
    steps: 0,
  } as Omit<LoopRig, 'loop' | 'hooks'> & { steps: number };
  const hooks: LoopRig['hooks'] = {
    onApply: null,
    fixedCostMs: 0,
    applyPending() {
      if (record) calls.push('applyPending');
      hooks.onApply?.();
    },
    fixedUpdate(dt) {
      expect(dt).toBe(SIM.DT);
      if (record) calls.push('fixedUpdate');
      rig.steps++;
      clock.advance(hooks.fixedCostMs);
    },
    update() {
      if (record) calls.push('update');
    },
    render(alpha) {
      if (record) calls.push('render');
      alphas.push(alpha);
    },
    recordPerf(s) {
      if (record) calls.push('recordPerf');
      samples.push({ ...s });
    },
  };
  const loop = createGameLoop({ scheduler, clock, hooks, pacer });
  return Object.assign(rig, { loop, hooks });
}

const HZ120 = 1000 / 120;
const HZ60 = 1000 / 60;

describe('GameLoop timestep', () => {
  it('120 Hz frames give exactly 120 steps per simulated second, one per frame', () => {
    const r = createLoopRig();
    r.loop.start();
    r.scheduler.runFrame(0);
    expect(r.steps).toBe(0);
    r.scheduler.runFrames(120, HZ120);
    expect(r.steps).toBe(120);
    for (let i = 1; i < r.samples.length; i++) expect(r.samples[i]!.steps).toBe(1);
    r.scheduler.runFrames(1200, HZ120);
    expect(r.steps).toBe(1320);
    expect(r.loop.simTick).toBe(1320);
  });

  it('60 Hz frames give 2 steps per frame', () => {
    const r = createLoopRig();
    r.loop.start();
    r.scheduler.runFrame(0);
    r.scheduler.runFrames(60, HZ60);
    expect(r.steps).toBe(120);
    for (let i = 1; i < r.samples.length; i++) expect(r.samples[i]!.steps).toBe(2);
  });

  it('clamps a 250 ms hitch to 0.1 s: 8 steps, the backlog dropped and counted', () => {
    const r = createLoopRig();
    r.loop.start();
    r.scheduler.runFrame(0);
    r.scheduler.runDeltas([250]);
    const s = r.samples[r.samples.length - 1]!;
    expect(s.steps).toBe(SIM.MAX_STEPS);
    expect(s.dropped).toBe(4);
    expect(s.frameMs).toBe(250);
    expect(r.loop.droppedSteps).toBe(4);
    r.scheduler.runFrames(10, HZ120);
    expect(r.samples[r.samples.length - 1]!.steps).toBe(1);
    expect(r.loop.droppedSteps).toBe(4);
  });

  it('keeps alpha in [0, 1) under jittery deltas', () => {
    const r = createLoopRig();
    const rng = createRng(7);
    r.loop.start();
    r.scheduler.runFrame(0);
    const deltas: number[] = [];
    for (let i = 0; i < 2000; i++) deltas.push(rng.range(0, 40));
    r.scheduler.runDeltas(deltas);
    for (const a of r.alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    expect(r.loop.alpha).toBe(r.alphas[r.alphas.length - 1]);
  });

  it('timeScale 0.25 gives 30 steps per second and never changes dt', () => {
    const r = createLoopRig();
    r.loop.setTimeScale(0.25);
    expect(r.loop.timeScale).toBe(0.25);
    r.loop.start();
    r.scheduler.runFrame(0);
    r.scheduler.runFrames(120, HZ120);
    expect(r.steps).toBe(30);
  });

  it('rejects non-finite or negative time scales (treated as 0: frozen sim)', () => {
    const r = createLoopRig();
    r.loop.setTimeScale(Number.NaN);
    expect(r.loop.timeScale).toBe(0);
    r.loop.setTimeScale(-2);
    expect(r.loop.timeScale).toBe(0);
    r.loop.start();
    r.scheduler.runFrame(0);
    r.scheduler.runFrames(30, HZ120);
    expect(r.steps).toBe(0);
    expect(r.samples).toHaveLength(31);
  });

  it('resetAccumulator prevents a catch-up burst (between frames and from applyPending)', () => {
    const r = createLoopRig();
    r.loop.start();
    r.scheduler.runFrame(0);
    r.scheduler.runDeltas([HZ120 * 1.9]);
    expect(r.samples[1]!.steps).toBe(1);
    expect(r.loop.alpha).toBeGreaterThan(0.8);
    r.loop.resetAccumulator();
    expect(r.loop.alpha).toBe(0);
    r.scheduler.runDeltas([HZ120 * 1.9]);
    expect(r.samples[2]!.steps).toBe(0);

    // Called from onUncovered during applyPending (resume from pause after a 100 ms stall).
    r.hooks.onApply = () => {
      r.loop.resetAccumulator();
    };
    r.scheduler.runDeltas([100]);
    expect(r.samples[3]!.steps).toBe(0);
    expect(r.samples[3]!.dropped).toBe(0);
    r.hooks.onApply = null;
    r.scheduler.runDeltas([HZ120]);
    expect(r.samples[4]!.steps).toBe(1);
  });
});

describe('GameLoop frame order and control', () => {
  it('runs applyPending, fixedUpdate xN, update, render, recordPerf in that order', () => {
    const r = createLoopRig(null, true);
    r.loop.start();
    r.scheduler.runFrame(0);
    r.calls.length = 0;
    r.scheduler.runDeltas([HZ60]);
    expect(r.calls).toEqual(['applyPending', 'fixedUpdate', 'fixedUpdate', 'update', 'render', 'recordPerf']);
  });

  it('measures sim and CPU time with the injected clock', () => {
    const r = createLoopRig();
    r.hooks.fixedCostMs = 0.25;
    r.loop.start();
    r.scheduler.runFrame(0);
    r.scheduler.runDeltas([HZ60]);
    const s = r.samples[1]!;
    expect(s.simMs).toBeCloseTo(0.5, 9);
    expect(s.cpuMs).toBeCloseTo(0.5, 9);
    expect(s.frameMs).toBeCloseTo(HZ60, 9);
  });

  it('start is idempotent, stop cancels the pending frame, restart re-baselines the timestamp', () => {
    const r = createLoopRig();
    r.loop.start();
    r.loop.start();
    expect(r.scheduler.pending).toBe(1);
    expect(r.loop.running).toBe(true);
    r.scheduler.runFrame(0);
    r.loop.stop();
    r.loop.stop();
    expect(r.loop.running).toBe(false);
    expect(r.scheduler.pending).toBe(0);
    r.loop.start();
    r.scheduler.runFrame(5000);
    expect(r.samples[r.samples.length - 1]!.steps).toBe(0);
    expect(r.samples[r.samples.length - 1]!.frameMs).toBe(0);
  });

  it('a callback firing after stop does nothing', () => {
    const scheduler = new FakeScheduler();
    let captured: ((ts: number) => void) | null = null;
    const spyScheduler = {
      request(cb: (ts: number) => void): number {
        captured = cb;
        return scheduler.request(cb);
      },
      cancel(): void {
        // Simulates a browser that already dequeued the callback.
      },
    };
    let frames = 0;
    const loop = createGameLoop({
      scheduler: spyScheduler,
      clock: new FakeClock(),
      pacer: null,
      hooks: {
        applyPending: () => {
          frames++;
        },
        fixedUpdate: () => undefined,
        update: () => undefined,
        render: () => undefined,
        recordPerf: () => undefined,
      },
    });
    loop.start();
    loop.stop();
    expect(captured).not.toBeNull();
    scheduler.runFrame(16);
    expect(frames).toBe(0);
  });

  it('skips frames the pacer rejects but keeps scheduling, and treats backwards time as zero', () => {
    let allow = false;
    const pacer: FramePacer = {
      setCap: () => undefined,
      setPlaying: () => undefined,
      shouldRun: () => allow,
      refreshHz: 120,
      effectiveCap: 60,
    };
    const r = createLoopRig(pacer);
    r.loop.start();
    r.scheduler.runFrames(5, HZ120);
    expect(r.samples).toHaveLength(0);
    expect(r.scheduler.pending).toBe(1);
    allow = true;
    r.scheduler.runFrame(100);
    r.scheduler.runFrame(116.7);
    expect(r.samples[1]!.steps).toBe(2);
    r.scheduler.runFrame(50);
    expect(r.samples[2]!.frameMs).toBe(0);
    expect(r.samples[2]!.steps).toBe(0);
  });
});
