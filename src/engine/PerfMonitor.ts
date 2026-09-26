/**
 * Frame statistics (plan section 10): PERF.RING_FRAMES ring buffers of frame interval, sim ms and CPU ms;
 * percentiles, long frames, missed-vsync ratio, dropped sim steps, and a program-count growth alarm.
 * Allocation-free after construction (percentiles sort a preallocated scratch array).
 */
import type { Logger } from '../contracts/ids';
import type { PerfPort, PerfSnapshot } from '../contracts/services';
import { PERF } from '../config/quality';
import type { FrameSample } from './GameLoop';

export interface PerfMonitor extends PerfPort {
  record(s: Readonly<FrameSample>): void;
  /** First call records the Boot baseline; growth afterwards logs a DEV error. */
  setProgramCount(programs: number): void;
  percentile(series: 'frame' | 'sim' | 'cpu', p: number): number;
  missedVsyncRatio(refreshHz: number): number;
  readonly frames: number;
  /** Extra: the last setPlaying value (the governor evaluates only while Playing). */
  readonly playing: boolean;
}

export interface PerfMonitorDeps {
  readonly log: Logger;
}

export type PerfSeries = 'frame' | 'sim' | 'cpu';

interface MutablePerfSnapshot {
  avgFps: number;
  p50: number;
  p95: number;
  p99: number;
  longFrames: number;
  cpuP95: number;
  droppedSteps: number;
}

class RingPerfMonitor implements PerfMonitor {
  private readonly log: Logger;
  private readonly size = PERF.RING_FRAMES;
  private readonly frameRing = new Float64Array(PERF.RING_FRAMES);
  private readonly simRing = new Float64Array(PERF.RING_FRAMES);
  private readonly cpuRing = new Float64Array(PERF.RING_FRAMES);
  private readonly scratch = new Float64Array(PERF.RING_FRAMES);
  private readonly snap: MutablePerfSnapshot = {
    avgFps: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    longFrames: 0,
    cpuP95: 0,
    droppedSteps: 0,
  };

  private head = 0;
  private count = 0;
  private total = 0;
  private dropped = 0;
  private isPlaying = false;
  private programBaseline = -1;
  private programMax = -1;

  constructor(deps: PerfMonitorDeps) {
    this.log = deps.log;
  }

  get frames(): number {
    return this.total;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  record(s: Readonly<FrameSample>): void {
    this.total++;
    this.dropped += s.dropped;
    // The first frame after start has no interval; keep it out of the frame-time series.
    if (s.frameMs <= 0) return;
    const i = this.head;
    this.frameRing[i] = s.frameMs;
    this.simRing[i] = s.simMs;
    this.cpuRing[i] = s.cpuMs;
    this.head = (i + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  setPlaying(on: boolean): void {
    this.isPlaying = on;
  }

  setProgramCount(programs: number): void {
    if (this.programBaseline < 0) {
      this.programBaseline = programs;
      this.programMax = programs;
      return;
    }
    if (programs > this.programMax) {
      this.programMax = programs;
      this.log.error('perf: shader program count grew after Boot', {
        baseline: this.programBaseline,
        programs,
      });
    }
  }

  percentile(series: PerfSeries, p: number): number {
    const n = this.count;
    if (n === 0) return 0;
    const src = series === 'frame' ? this.frameRing : series === 'sim' ? this.simRing : this.cpuRing;
    const s = this.scratch;
    for (let i = 0; i < this.size; i++) s[i] = i < n ? src[i]! : Number.POSITIVE_INFINITY;
    s.sort();
    const q = p <= 0 ? 0 : p >= 100 ? 1 : p / 100;
    const pos = q * (n - 1);
    const lo = Math.floor(pos);
    const hi = lo + 1 < n ? lo + 1 : lo;
    const t = pos - lo;
    return s[lo]! + (s[hi]! - s[lo]!) * t;
  }

  missedVsyncRatio(refreshHz: number): number {
    const n = this.count;
    if (n === 0 || !(refreshHz > 0)) return 0;
    const vsyncMs = 1000 / refreshHz;
    let expected = 0;
    let missed = 0;
    for (let i = 0; i < n; i++) {
      let v = Math.round(this.frameRing[i]! / vsyncMs);
      if (v < 1) v = 1;
      expected += v;
      missed += v - 1;
    }
    return missed / expected;
  }

  snapshot(): PerfSnapshot {
    const s = this.snap;
    const n = this.count;
    let sum = 0;
    let long = 0;
    for (let i = 0; i < n; i++) {
      const f = this.frameRing[i]!;
      sum += f;
      if (f > PERF.LONG_FRAME_MS) long++;
    }
    s.avgFps = n > 0 && sum > 0 ? (1000 * n) / sum : 0;
    s.p50 = this.percentile('frame', 50);
    s.p95 = this.percentile('frame', 95);
    s.p99 = this.percentile('frame', 99);
    s.longFrames = long;
    s.cpuP95 = this.percentile('cpu', 95);
    s.droppedSteps = this.dropped;
    return s;
  }
}

export function createPerfMonitor(deps: PerfMonitorDeps): PerfMonitor {
  return new RingPerfMonitor(deps);
}
