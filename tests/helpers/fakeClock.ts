/** Deterministic time sources for engine tests (GameLoop, FramePacer, SaveStore debounce, MenuNavigator). */
import type { ClockPort, FrameScheduler } from '../../src/contracts/services';

export class FakeClock implements ClockPort {
  private t: number;

  constructor(startMs = 0) {
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }

  set(ms: number): void {
    this.t = ms;
  }
}

/** rAF stand-in: callbacks requested during a frame run on the NEXT runFrame(), like the browser. */
export class FakeScheduler implements FrameScheduler {
  private queue: { id: number; cb: (ts: number) => void }[] = [];
  private nextId = 1;
  private lastTs = 0;
  frames = 0;

  request(cb: (timestampMs: number) => void): number {
    const id = this.nextId++;
    this.queue.push({ id, cb });
    return id;
  }

  cancel(id: number): void {
    this.queue = this.queue.filter((q) => q.id !== id);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Runs the callbacks queued before this call with the given timestamp; returns how many ran. */
  runFrame(timestampMs: number): number {
    const batch = this.queue;
    this.queue = [];
    this.lastTs = timestampMs;
    this.frames++;
    for (const q of batch) q.cb(timestampMs);
    return batch.length;
  }

  /** Runs n frames spaced by dtMs after the last timestamp (e.g. 1000/120 for ProMotion). */
  runFrames(n: number, dtMs: number): void {
    for (let i = 0; i < n; i++) this.runFrame(this.lastTs + dtMs);
  }

  /** Runs frames at explicit deltas (hitch tests). */
  runDeltas(deltasMs: readonly number[]): void {
    for (const d of deltasMs) this.runFrame(this.lastTs + d);
  }
}
