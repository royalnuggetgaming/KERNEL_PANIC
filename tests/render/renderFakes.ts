/** Plain Float32Array batch/ring doubles (same semantics as InstanceBatch/GpuRingBuffer, no three). */
import { INSTANCE_LAYOUT } from '../../src/contracts/render';
import type { WorldView } from '../../src/contracts/world';
import type { BatchSink, FrameContext, RingSink } from '../../src/render/views/types';

const S = INSTANCE_LAYOUT.stride;

export class FakeBatch implements BatchSink {
  readonly capacity: number;
  readonly data: Float32Array;
  n = 0;
  commits = 0;
  lastDense: boolean | null = null;
  dirtyMin = Infinity;
  dirtyMax = -1;
  writeLog: number[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * S);
  }

  get count(): number {
    return this.n;
  }

  begin(): void {
    this.n = 0;
  }

  push(...v: [number, number, number, number, number, number, number, number]): number {
    if (this.n >= this.capacity) return -1;
    const i = this.n++;
    this.data.set(v, i * S);
    return i;
  }

  writeAt(i: number, ...v: [number, number, number, number, number, number, number, number]): void {
    if (i < 0 || i >= this.capacity) return;
    this.data.set(v, i * S);
    this.writeLog.push(i);
    this.dirtyMin = Math.min(this.dirtyMin, i);
    this.dirtyMax = Math.max(this.dirtyMax, i);
  }

  setCount(n: number): void {
    this.n = Math.max(0, Math.min(this.capacity, n));
  }

  markDirty(first: number, count: number): void {
    this.dirtyMin = Math.min(this.dirtyMin, first);
    this.dirtyMax = Math.max(this.dirtyMax, first + count - 1);
  }

  commit(dense = true): void {
    this.commits++;
    this.lastDense = dense;
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  /** Instance i as 8 numbers. */
  rec(i: number): number[] {
    return Array.from(this.data.subarray(i * S, i * S + S));
  }
}

export class FakeRing implements RingSink {
  readonly capacity: number;
  readonly stride: number;
  readonly data: Float32Array;
  head = 0;
  claims = 0;
  commits = 0;
  resets = 0;

  constructor(capacity: number, stride: number) {
    this.capacity = capacity;
    this.stride = stride;
    this.data = new Float32Array(capacity * stride);
  }

  claim(): number {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.claims++;
    return i * this.stride;
  }

  commit(): void {
    this.commits++;
  }

  reset(): void {
    this.data.fill(0);
    this.head = 0;
    this.resets++;
  }

  rec(i: number): number[] {
    return Array.from(this.data.subarray(i * this.stride, (i + 1) * this.stride));
  }
}

export function frameCtx(world: WorldView, alpha = 1, time = 100, frameDt = 1 / 120): FrameContext {
  return { world, alpha, frameDt, time, simTime: world.time };
}
