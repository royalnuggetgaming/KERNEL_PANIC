/**
 * Structural batch/ring interfaces the views and fx write through (render/InstanceBatch and render/GpuRingBuffer
 * satisfy them), so view sync can be unit-tested with plain Float32Array fakes. Plus the per-frame context.
 */
import type { WorldView } from '../../contracts/world';

export interface BatchSink {
  readonly capacity: number;
  readonly count: number;
  readonly data: Float32Array;
  begin(): void;
  push(
    x: number,
    z: number,
    yaw: number,
    scale: number,
    flash: number,
    spawnT: number,
    tint: number,
    seed: number,
  ): number;
  writeAt(
    i: number,
    x: number,
    z: number,
    yaw: number,
    scale: number,
    flash: number,
    spawnT: number,
    tint: number,
    seed: number,
  ): void;
  setCount(n: number): void;
  markDirty(first: number, count: number): void;
  commit(dense?: boolean): void;
}

export interface RingSink {
  readonly capacity: number;
  readonly stride: number;
  readonly data: Float32Array;
  claim(): number;
  commit(): void;
  reset(): void;
}

/** Per-frame render context (one reusable object owned by the bridge). */
export interface FrameContext {
  world: WorldView;
  /** Interpolation alpha between prev and current sim state. */
  alpha: number;
  frameDt: number;
  /** Shared uTime clock (wrapped seconds): spawnT/t0 of instance and ring records. */
  time: number;
  /** Interpolated render sim time = world.time - (1 - alpha) * SIM.DT (uSimTime). */
  simTime: number;
}

/** Normalises an integer seed/slot into [0, 1) for shader hashing (keeps float precision). */
export function seed01(n: number): number {
  const v = (n >>> 0) % 4099;
  return v / 4099;
}

export function lerp1(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
