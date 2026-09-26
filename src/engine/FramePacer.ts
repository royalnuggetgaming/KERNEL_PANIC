/**
 * Frame pacing (plan section 10.1). Estimates the display refresh from the median rAF delta and gates frames
 * for the 60/120 caps with target-time scheduling (a clean 2-vsync cadence for 60 on a 120 Hz display, and an
 * exact long-run 60 average on 144 Hz). 'auto' renders at the display rate and latches down to a 60 cap while
 * Playing when missed vsyncs exceed PERF.MISSED_VSYNC_RATIO over PERF.MISSED_VSYNC_WINDOW_S.
 */
import type { FrameCap } from '../contracts/save';
import { PERF } from '../config/quality';

export interface FramePacer {
  setCap(cap: FrameCap): void;
  /** 'auto' only degrades to a 60 cap while playing. */
  setPlaying(on: boolean): void;
  /** Called with every rAF timestamp; true when this callback should run a frame. */
  shouldRun(timestampMs: number): boolean;
  readonly refreshHz: number;
  readonly effectiveCap: 60 | 120 | null;
}

/** rAF deltas kept for the refresh estimate. */
const DELTA_RING = 32;
/** Samples needed before the missed-vsync detector trusts the estimate. */
const MIN_SAMPLES_FOR_MISSES = 8;
/** Deltas above this are tab switches / hitches: ignored by the estimate and reset the miss window. */
const MAX_PLAUSIBLE_DELTA_MS = 250;
const DEFAULT_REFRESH_HZ = 60;
/** Re-sort the ring every N samples once it is full (the estimate moves slowly). */
const MEDIAN_EVERY = 8;

class TargetTimePacer implements FramePacer {
  private cap: FrameCap = 'auto';
  private playing = false;
  private degraded = false;

  private readonly deltas = new Float64Array(DELTA_RING);
  private readonly scratch = new Float64Array(DELTA_RING);
  private deltaCount = 0;
  private deltaHead = 0;
  private sinceMedian = 0;
  private medianMs = 1000 / DEFAULT_REFRESH_HZ;
  private hasMedian = false;

  private prevTs = 0;
  private hasPrev = false;
  private nextTarget = 0;
  private hasTarget = false;

  private windowMs = 0;
  private windowExpected = 0;
  private windowMissed = 0;

  get refreshHz(): number {
    return Math.round(1000 / this.medianMs);
  }

  get effectiveCap(): 60 | 120 | null {
    switch (this.cap) {
      case 60:
        return 60;
      case 120:
        return 120;
      case 'uncapped':
        return null;
      case 'auto':
        return this.degraded && this.playing ? 60 : null;
    }
  }

  setCap(cap: FrameCap): void {
    this.cap = cap;
    this.degraded = false;
    this.hasTarget = false;
    this.resetWindow();
  }

  setPlaying(on: boolean): void {
    if (this.playing === on) return;
    this.playing = on;
    this.hasTarget = false;
    this.resetWindow();
  }

  shouldRun(timestampMs: number): boolean {
    const delta = this.hasPrev ? timestampMs - this.prevTs : 0;
    this.prevTs = timestampMs;
    this.hasPrev = true;
    if (delta > 0) this.observe(delta);

    const cap = this.effectiveCap;
    if (cap === null) {
      this.hasTarget = false;
      return true;
    }
    const interval = 1000 / cap;
    if (!this.hasTarget) {
      this.hasTarget = true;
      this.nextTarget = timestampMs + interval;
      return true;
    }
    const vsync = this.hasMedian ? this.medianMs : interval;
    const tolerance = 0.5 * (vsync < interval ? vsync : interval);
    if (timestampMs < this.nextTarget - tolerance) return false;
    // Far behind (hitch or background tab): re-anchor instead of bursting to catch up.
    if (timestampMs - this.nextTarget > interval) this.nextTarget = timestampMs;
    this.nextTarget += interval;
    return true;
  }

  private observe(delta: number): void {
    if (delta > MAX_PLAUSIBLE_DELTA_MS) {
      this.resetWindow();
      return;
    }
    this.deltas[this.deltaHead] = delta;
    this.deltaHead = (this.deltaHead + 1) % DELTA_RING;
    if (this.deltaCount < DELTA_RING) this.deltaCount++;
    this.sinceMedian++;
    if (this.deltaCount < DELTA_RING || this.sinceMedian >= MEDIAN_EVERY) this.updateMedian();
    this.trackMisses(delta);
  }

  private updateMedian(): void {
    const n = this.deltaCount;
    const s = this.scratch;
    for (let i = 0; i < DELTA_RING; i++) s[i] = i < n ? this.deltas[i]! : Number.POSITIVE_INFINITY;
    s.sort();
    this.medianMs = s[(n - 1) >> 1]!;
    this.hasMedian = true;
    this.sinceMedian = 0;
  }

  private trackMisses(delta: number): void {
    if (this.cap !== 'auto' || !this.playing || this.degraded) return;
    if (this.deltaCount < MIN_SAMPLES_FOR_MISSES) return;
    let vsyncs = Math.round(delta / this.medianMs);
    if (vsyncs < 1) vsyncs = 1;
    this.windowExpected += vsyncs;
    this.windowMissed += vsyncs - 1;
    this.windowMs += delta;
    if (this.windowMs < PERF.MISSED_VSYNC_WINDOW_S * 1000) return;
    if (this.windowMissed / this.windowExpected > PERF.MISSED_VSYNC_RATIO) {
      this.degraded = true;
      this.hasTarget = false;
    }
    this.resetWindow();
  }

  private resetWindow(): void {
    this.windowMs = 0;
    this.windowExpected = 0;
    this.windowMissed = 0;
  }
}

export function createFramePacer(): FramePacer {
  return new TargetTimePacer();
}
