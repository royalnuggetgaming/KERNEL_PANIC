/**
 * Structural batch/ring interfaces the views and fx write through (render/InstanceBatch and render/GpuRingBuffer
 * satisfy them), so view sync can be unit-tested with plain Float32Array fakes. Plus the per-frame context.
 */
import { INSTANCE_LAYOUT } from '../../contracts/render';
import type { WorldView } from '../../contracts/world';

const STRIDE = INSTANCE_LAYOUT.stride;

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

/** Float offsets of the instance record fields (aT = x, z, yaw, scale; aS = flash, spawnT, tint, seed). */
export const REC = {
  X: INSTANCE_LAYOUT.aT,
  Z: INSTANCE_LAYOUT.aT + 1,
  YAW: INSTANCE_LAYOUT.aT + 2,
  SCALE: INSTANCE_LAYOUT.aT + 3,
  FLASH: INSTANCE_LAYOUT.aS,
  SPAWN: INSTANCE_LAYOUT.aS + 1,
  TINT: INSTANCE_LAYOUT.aS + 2,
  SEED: INSTANCE_LAYOUT.aS + 3,
} as const;

/**
 * Dense append for hot view loops: reserves the next instance and returns its FLOAT offset into `b.data`
 * (-1 when full). The caller stores the 8 fields directly, so no computed double crosses a non-inlined call
 * (TurboFan boxes every double argument of push() into a HeapNumber when push is not inlined).
 */
export function appendRecord(b: BatchSink): number {
  const i = b.count;
  if (i >= b.capacity) return -1;
  b.setCount(i + 1);
  return i * STRIDE;
}

