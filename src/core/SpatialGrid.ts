/**
 * Uniform grid rebuilt each tick by counting sort into typed arrays. Items are circles stored in the cell
 * containing their centre (positions outside the grid clamp to border cells); queries expand by the largest
 * radius added since begin(), so results are exact and each id is reported once.
 */
import type { SpatialGridApi } from '../contracts/sim';

export interface SpatialGridOptions {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  /** World x/z of the grid's min corner. */
  readonly originX: number;
  readonly originZ: number;
  /** Maximum items per build. Extra add() calls are ignored and counted in `overflow`. */
  readonly capacity: number;
}

export class SpatialGrid implements SpatialGridApi {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly capacity: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly ids: Int32Array;
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  private readonly rs: Float64Array;
  private readonly cellOf: Int32Array;
  private readonly cellStart: Int32Array;
  private readonly cellFill: Int32Array;
  private readonly sorted: Int32Array;
  private n = 0;
  private maxR = 0;
  private overflowCount = 0;

  constructor(o: SpatialGridOptions) {
    this.cols = o.cols;
    this.rows = o.rows;
    this.cellSize = o.cellSize;
    this.originX = o.originX;
    this.originZ = o.originZ;
    this.capacity = o.capacity;
    this.ids = new Int32Array(o.capacity);
    this.xs = new Float64Array(o.capacity);
    this.zs = new Float64Array(o.capacity);
    this.rs = new Float64Array(o.capacity);
    this.cellOf = new Int32Array(o.capacity);
    this.cellStart = new Int32Array(o.cols * o.rows + 1);
    this.cellFill = new Int32Array(o.cols * o.rows);
    this.sorted = new Int32Array(o.capacity);
  }

  get count(): number {
    return this.n;
  }

  get overflow(): number {
    return this.overflowCount;
  }

  begin(): void {
    this.n = 0;
    this.maxR = 0;
  }

  add(id: number, x: number, z: number, radius: number): void {
    if (this.n >= this.capacity) {
      this.overflowCount++;
      return;
    }
    const i = this.n++;
    this.ids[i] = id;
    this.xs[i] = x;
    this.zs[i] = z;
    this.rs[i] = radius;
    if (radius > this.maxR) this.maxR = radius;
    this.cellOf[i] = this.cellRow(z) * this.cols + this.cellCol(x);
  }

  build(): void {
    const cells = this.cols * this.rows;
    const start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < this.n; i++) start[this.cellOf[i]! + 1]!++;
    for (let c = 0; c < cells; c++) start[c + 1]! += start[c]!;
    const fill = this.cellFill;
    for (let c = 0; c < cells; c++) fill[c] = start[c]!;
    for (let i = 0; i < this.n; i++) {
      const c = this.cellOf[i]!;
      this.sorted[fill[c]!++] = i;
    }
  }

  queryCircle(x: number, z: number, r: number, out: Int32Array): number {
    const reach = r + this.maxR;
    const c0 = this.cellCol(x - reach);
    const c1 = this.cellCol(x + reach);
    const r0 = this.cellRow(z - reach);
    const r1 = this.cellRow(z + reach);
    let written = 0;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * this.cols + col;
        const end = this.cellStart[cell + 1]!;
        for (let k = this.cellStart[cell]!; k < end; k++) {
          const i = this.sorted[k]!;
          const dx = this.xs[i]! - x;
          const dz = this.zs[i]! - z;
          const rr = r + this.rs[i]!;
          if (dx * dx + dz * dz <= rr * rr) {
            if (written >= out.length) return written;
            out[written++] = this.ids[i]!;
          }
        }
      }
    }
    return written;
  }

  queryAabb(minX: number, minZ: number, maxX: number, maxZ: number, out: Int32Array): number {
    const m = this.maxR;
    const c0 = this.cellCol(minX - m);
    const c1 = this.cellCol(maxX + m);
    const r0 = this.cellRow(minZ - m);
    const r1 = this.cellRow(maxZ + m);
    let written = 0;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * this.cols + col;
        const end = this.cellStart[cell + 1]!;
        for (let k = this.cellStart[cell]!; k < end; k++) {
          const i = this.sorted[k]!;
          const x = this.xs[i]!;
          const z = this.zs[i]!;
          const ri = this.rs[i]!;
          if (x + ri < minX || x - ri > maxX || z + ri < minZ || z - ri > maxZ) continue;
          if (written >= out.length) return written;
          out[written++] = this.ids[i]!;
        }
      }
    }
    return written;
  }

  private cellCol(x: number): number {
    const c = Math.floor((x - this.originX) / this.cellSize);
    // NaN-safe: NaN >= 0 is false, so NaN maps to cell 0.
    return c >= 0 ? (c >= this.cols ? this.cols - 1 : c) : 0;
  }

  private cellRow(z: number): number {
    const r = Math.floor((z - this.originZ) / this.cellSize);
    return r >= 0 ? (r >= this.rows ? this.rows - 1 : r) : 0;
  }
}
