/**
 * Write-once GPU ring buffer (particles, damage digits, shockwaves, decals). Each record is written once at
 * spawn; lifetime/motion is evaluated in the vertex shader from the record (t0, life, ...), and expired
 * records collapse to a degenerate position there. instanceCount stays at the active limit (capacity unless a
 * quality preset lowers it with setLimit: fewer instances drawn, older records recycled sooner). At most 2 update ranges
 * per frame (the ring can wrap once); range objects are persistent (no per-frame allocation).
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

export interface RingAttribute {
  /** GLSL attribute name (e.g. 'aP0'). */
  readonly name: string;
  /** Components (1-4). */
  readonly size: 1 | 2 | 3 | 4;
  /** Float offset within the record. */
  readonly offset: number;
}

interface UpdateRange {
  start: number;
  count: number;
}

export class GpuRingBuffer {
  readonly capacity: number;
  /** Floats per record. */
  readonly stride: number;
  readonly geometry: InstancedBufferGeometry;
  readonly mesh: Mesh;
  readonly data: Float32Array;
  private readonly buffer: InstancedInterleavedBuffer;
  private readonly ranges: [UpdateRange, UpdateRange];
  private head = 0;
  /** Active ring size (<= capacity): claims wrap here and only this many instances are drawn. */
  private limit: number;
  private pendingStart = -1;
  private pendingCount = 0;
  private written = 0;

  constructor(
    base: BufferGeometry,
    material: Material,
    capacity: number,
    stride: number,
    attributes: readonly RingAttribute[],
    name = 'ring',
  ) {
    this.capacity = capacity;
    this.limit = capacity;
    this.stride = stride;
    this.data = new Float32Array(capacity * stride);
    this.buffer = new InstancedInterleavedBuffer(this.data, stride, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    for (const key of Object.keys(base.attributes)) g.setAttribute(key, base.getAttribute(key));
    for (const a of attributes) {
      if (a.offset + a.size > stride)
        throw new RangeError(`GpuRingBuffer: attribute ${a.name} exceeds stride`);
      g.setAttribute(a.name, new InterleavedBufferAttribute(this.buffer, a.size, a.offset));
    }
    g.instanceCount = capacity;
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

  /** Records written since creation/reset (the mesh becomes visible after the first). */
  get totalWritten(): number {
    return this.written;
  }

  get activeLimit(): number {
    return this.limit;
  }

  /**
   * Quality budget for pure-FX rings: wraps claims at `n` (clamped to 1..capacity) and draws only `n` instances.
   * Pending ranges are dropped in favour of one full upload (a settings change, never per frame).
   */
  setLimit(n: number): void {
    const next = Math.max(1, Math.min(this.capacity, Math.floor(n)));
    if (next === this.limit) return;
    this.limit = next;
    this.geometry.instanceCount = next;
    if (this.head >= next) this.head = 0;
    this.pendingStart = -1;
    this.pendingCount = 0;
    this.buffer.updateRanges.length = 0;
    this.buffer.needsUpdate = true;
  }

  /**
   * Claims the next record (overwriting the oldest when full) and returns its FLOAT offset into `data`.
   * The caller writes `stride` floats starting there. Claims are contiguous modulo capacity.
   */
  claim(): number {
    const i = this.head;
    this.head = this.head + 1 === this.limit ? 0 : this.head + 1;
    if (this.pendingStart < 0) {
      this.pendingStart = i;
      this.pendingCount = 1;
    } else if (this.pendingCount < this.limit) {
      this.pendingCount++;
    }
    this.written++;
    return i * this.stride;
  }

  /** Uploads records claimed since the last commit (<= 2 ranges when the ring wrapped). */
  commit(): void {
    if (this.pendingStart < 0) return;
    const list = this.buffer.updateRanges;
    list.length = 0;
    const start = this.pendingStart;
    const count = this.pendingCount;
    const first = this.ranges[0];
    if (start + count <= this.limit) {
      first.start = start * this.stride;
      first.count = count * this.stride;
      list.push(first);
    } else {
      const tail = this.limit - start;
      first.start = start * this.stride;
      first.count = tail * this.stride;
      const second = this.ranges[1];
      second.start = 0;
      second.count = (count - tail) * this.stride;
      list.push(first, second);
    }
    this.buffer.needsUpdate = true;
    this.mesh.visible = true;
    this.pendingStart = -1;
    this.pendingCount = 0;
  }

  /** Clears all records (full upload of zeros) and hides the mesh; for run disposal. */
  reset(): void {
    this.data.fill(0);
    this.head = 0;
    this.pendingStart = -1;
    this.pendingCount = 0;
    this.written = 0;
    this.buffer.updateRanges.length = 0;
    this.buffer.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
