/**
 * Fixed-timestep game loop (plan section 10.1). Driven by rAF timestamps through an injected FrameScheduler;
 * the ClockPort is used only to measure CPU time. SIM.DT = 1/120 s, the frame delta is clamped to
 * SIM.MAX_FRAME_DT, at most SIM.MAX_STEPS fixed steps run per frame and the rest of the backlog is dropped and
 * counted (momentary slow-motion instead of a spiral of death). timeScale multiplies the accumulator input,
 * never dt. Frame order: applyPending, fixedUpdate x N, update, render(alpha), recordPerf.
 */
import type { ClockPort, FrameScheduler, LoopControl } from '../contracts/services';
import { SIM } from '../config/tuning';
import type { FramePacer } from './FramePacer';

export interface FrameSample {
  frameMs: number;
  simMs: number;
  cpuMs: number;
  steps: number;
  dropped: number;
}

export interface LoopHooks {
  applyPending(): void;
  fixedUpdate(dt: number): void;
  update(frameDt: number): void;
  render(alpha: number, frameDt: number): void;
  /** Reused sample object: copy what you need. */
  recordPerf(sample: Readonly<FrameSample>): void;
}

export interface GameLoopDeps {
  readonly scheduler: FrameScheduler;
  readonly clock: ClockPort; // CPU timing only; sim time comes from rAF timestamps
  readonly hooks: LoopHooks;
  readonly pacer: FramePacer | null;
}

export interface GameLoop extends LoopControl {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Total fixed steps dropped by the MAX_STEPS clamp. */
  readonly droppedSteps: number;
  readonly alpha: number;
}

/**
 * Tolerance (seconds) for accumulator comparisons: rAF timestamps are floating point, so 1000/120 ms deltas can
 * land a hair below SIM.DT. Without it a 120 Hz display would alternate 0- and 2-step frames.
 */
const STEP_EPSILON_S = 1e-7;

class FixedStepLoop implements GameLoop {
  private readonly scheduler: FrameScheduler;
  private readonly clock: ClockPort;
  private readonly hooks: LoopHooks;
  private readonly pacer: FramePacer | null;
  private readonly sample: FrameSample = { frameMs: 0, simMs: 0, cpuMs: 0, steps: 0, dropped: 0 };
  private readonly onFrame: (timestampMs: number) => void;

  private handle = 0;
  private isRunning = false;
  private lastTs = 0;
  private hasLastTs = false;
  private accumulator = 0;
  private scale = 1;
  private skipDelta = false;
  private tick = 0;
  private dropTotal = 0;
  private currentAlpha = 0;

  constructor(deps: GameLoopDeps) {
    this.scheduler = deps.scheduler;
    this.clock = deps.clock;
    this.hooks = deps.hooks;
    this.pacer = deps.pacer;
    this.onFrame = (ts: number): void => {
      this.frame(ts);
    };
  }

  get running(): boolean {
    return this.isRunning;
  }
  get droppedSteps(): number {
    return this.dropTotal;
  }
  get alpha(): number {
    return this.currentAlpha;
  }
  get timeScale(): number {
    return this.scale;
  }
  get simTick(): number {
    return this.tick;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.hasLastTs = false;
    this.handle = this.scheduler.request(this.onFrame);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.scheduler.cancel(this.handle);
    this.handle = 0;
  }

  resetAccumulator(): void {
    this.accumulator = 0;
    this.currentAlpha = 0;
    // The delta of the frame in progress (or the next one) is discarded too, so no catch-up burst follows.
    this.skipDelta = true;
  }

  setTimeScale(s: number): void {
    this.scale = Number.isFinite(s) && s > 0 ? s : 0;
  }

  private frame(ts: number): void {
    if (!this.isRunning) return;
    this.handle = this.scheduler.request(this.onFrame);
    if (this.pacer !== null && !this.pacer.shouldRun(ts)) return;

    let rawMs = this.hasLastTs ? ts - this.lastTs : 0;
    if (rawMs < 0) rawMs = 0;
    this.lastTs = ts;
    this.hasLastTs = true;
    let frameDt = rawMs / 1000;
    if (frameDt > SIM.MAX_FRAME_DT) frameDt = SIM.MAX_FRAME_DT;

    const hooks = this.hooks;
    const cpuStart = this.clock.now();
    hooks.applyPending();
    if (!this.skipDelta) this.accumulator += frameDt * this.scale;
    this.skipDelta = false;

    const simStart = this.clock.now();
    let steps = 0;
    while (this.accumulator + STEP_EPSILON_S >= SIM.DT && steps < SIM.MAX_STEPS) {
      hooks.fixedUpdate(SIM.DT);
      this.accumulator -= SIM.DT;
      this.tick++;
      steps++;
    }
    let dropped = 0;
    if (this.accumulator + STEP_EPSILON_S >= SIM.DT) {
      dropped = Math.floor((this.accumulator + STEP_EPSILON_S) / SIM.DT);
      this.accumulator -= dropped * SIM.DT;
      this.dropTotal += dropped;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    const simMs = this.clock.now() - simStart;

    let a = this.accumulator / SIM.DT;
    if (a >= 1) a = 0.999999;
    this.currentAlpha = a;
    hooks.update(frameDt);
    hooks.render(a, frameDt);

    const s = this.sample;
    s.frameMs = rawMs;
    s.simMs = simMs;
    s.cpuMs = this.clock.now() - cpuStart;
    s.steps = steps;
    s.dropped = dropped;
    hooks.recordPerf(s);
  }
}

export function createGameLoop(deps: GameLoopDeps): GameLoop {
  return new FixedStepLoop(deps);
}
