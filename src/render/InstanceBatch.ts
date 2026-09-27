/**
 * One instanced draw call: an InstancedBufferGeometry sharing the base geometry's attributes plus one
 * interleaved per-instance buffer of INSTANCE_LAYOUT.stride floats (aT = x,z,yaw,scale; aS = flash,spawnT,
 * tint,seed) in DynamicDrawUsage.
 *
 * Upload discipline (three 0.186): InterleavedBuffer.addUpdateRange() allocates a {start,count} object per
 * call, so the batch keeps its own persistent range objects and writes them into `updateRanges` directly;
 * three's WebGLAttributes uploads the ranges and then calls clearUpdateRanges(), which is replaced per buffer
 * by a no-op so the list (and its backing store) persists. needsUpdate bumps the buffer version. Zero
 * allocation per frame.
 */
import {
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  type BufferGeometry,
  type Material,
} from 'three';
import { INSTANCE_LAYOUT } from '../contracts/render';

const STRIDE = INSTANCE_LAYOUT.stride;

interface UpdateRange {
  start: number;
  count: number;
}

function keepUpdateRanges(): void {
  // Intentionally keeps the persistent range list (see the constructor).
}

export class InstanceBatch {
  readonly capacity: number;
  readonly geometry: InstancedBufferGeometry;
  readonly mesh: Mesh;
  /** capacity * STRIDE floats. Write through push()/writeAt() or directly, then commit(). */
  readonly data: Float32Array;
  private readonly buffer: InstancedInterleavedBuffer;
  private readonly ranges: [UpdateRange, UpdateRange];
  private n = 0;
  private dirtyMin = Number.POSITIVE_INFINITY;
  private dirtyMax = -1;

  constructor(base: BufferGeometry, material: Material, capacity: number, name = 'batch') {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    this.buffer = new InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    // three's clearUpdateRanges() (after each upload) sets length = 0, which drops the array's backing store so
    // the next push reallocates it every frame. The batch owns its single persistent range and rewrites it
    // before every needsUpdate, so the list is kept as is (three reads it only on a version bump).
    this.buffer.clearUpdateRanges = keepUpdateRanges;
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    for (const key of Object.keys(base.attributes)) {
      const attr = base.getAttribute(key);
      g.setAttribute(key, attr);
    }
    g.setAttribute('aT', new InterleavedBufferAttribute(this.buffer, 4, INSTANCE_LAYOUT.aT));
    g.setAttribute('aS', new InterleavedBufferAttribute(this.buffer, 4, INSTANCE_LAYOUT.aS));
    g.instanceCount = 0;
    this.geometry = g;
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.name = name;
    this.ranges = [
      { start: 0, count: 0 },
      { start: 0, count: 0 },
    ];
  }

  /** Active instance count (== geometry.instanceCount after commit). */
  get count(): number {
    return this.n;
  }

  /** Dense mode: start a frame. */
  begin(): void {
    this.n = 0;
  }

  /** Dense mode: append one instance; silently ignored when full. Returns the index or -1. */
  push(
    x: number,
    z: number,
    yaw: number,
    scale: number,
    flash: number,
    spawnT: number,
    tint: number,
    seed: number,
  ): number {
    if (this.n >= this.capacity) return -1;
    const i = this.n++;
    this.write(i, x, z, yaw, scale, flash, spawnT, tint, seed);
    return i;
  }

  /** Sparse mode: overwrite instance i (i < capacity) and mark it dirty. */
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
  ): void {
    if (i < 0 || i >= this.capacity) return;
    this.write(i, x, z, yaw, scale, flash, spawnT, tint, seed);
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** Sparse mode: set the drawn instance count (instances [0, n)). */
  setCount(n: number): void {
    this.n = n < 0 ? 0 : n > this.capacity ? this.capacity : n;
  }

  /** Sparse mode: mark instances [first, first + count) for upload after direct `data` writes. */
  markDirty(first: number, count: number): void {
    if (count <= 0) return;
    if (first < this.dirtyMin) this.dirtyMin = first;
    const last = first + count - 1;
    if (last > this.dirtyMax) this.dirtyMax = last;
  }

  /**
   * Uploads this frame's changes. Dense mode (after push) uploads [0, count); sparse mode uploads the
   * dirty span. One update range, no allocation.
   */
  commit(dense = true): void {
    this.geometry.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    let first: number;
    let last: number;
    if (dense) {
      first = 0;
      last = this.n - 1;
    } else {
      first = this.dirtyMin;
      last = this.dirtyMax;
    }
    this.dirtyMin = Number.POSITIVE_INFINITY;
    this.dirtyMax = -1;
    if (last < first) return;
    const r = this.ranges[0];
    r.start = first * STRIDE;
    r.count = (last - first + 1) * STRIDE;
    const list = this.buffer.updateRanges;
    if (list.length !== 1 || list[0] !== r) {
      list.length = 0;
      list.push(r);
    }
    this.buffer.needsUpdate = true;
  }

  /** Disposes only the per-batch instanced geometry (the base attributes and material are shared). */
  dispose(): void {
    this.geometry.dispose();
  }

  private write(
    i: number,
    x: number,
    z: number,
    yaw: number,
    scale: number,
    flash: number,
    spawnT: number,
    tint: number,
    seed: number,
  ): void {
    const d = this.data;
    const o = i * STRIDE;
    d[o] = x;
    d[o + 1] = z;
    d[o + 2] = yaw;
    d[o + 3] = scale;
    d[o + 4] = flash;
    d[o + 5] = spawnT;
    d[o + 6] = tint;
    d[o + 7] = seed;
  }
}
