/**
 * Uniform grid rebuilt each tick by counting sort into typed arrays. Items are circles stored in the cell
 * containing their centre (positions outside the grid clamp to border cells); queries expand by the largest
 * radius added since begin(), so results are exact and each id is reported once.
 */
import type { SpatialGridApi } from '../contracts/sim';

/**
 * Scratch inputs for the *In methods and the grid*In helpers: [x, z, radius] for addIn/queryCircleIn and
 * [minX, minZ, maxX, maxZ] for queryAabbIn. Hot callers write positions here instead of passing them as
 * arguments: a double passed to a call that is not inlined is boxed into a HeapNumber (Maglev/TurboFan in the
 * browser), which made the per-tick grid rebuild and the per-shot queries allocate.
 */
export const GRID_IN = new Float64Array(4);

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
    GRID_IN[0] = x;
    GRID_IN[1] = z;
    GRID_IN[2] = radius;
    this.addIn(id);
  }

  /** add() with x, z, radius read from GRID_IN[0..2]. */
  addIn(id: number): void {
    if (this.n >= this.capacity) {
      this.overflowCount++;
      return;
    }
    const x = GRID_IN[0]!;
    const z = GRID_IN[1]!;
    const radius = GRID_IN[2]!;
    const i = this.n++;
    this.ids[i] = id;
    this.xs[i] = x;
    this.zs[i] = z;
    this.rs[i] = radius;
    if (radius > this.maxR) this.maxR = radius;
    // Column/row clamps inlined (NaN-safe: NaN >= 0 is false, so NaN maps to cell 0): no double crosses a call.
    const cs = this.cellSize;
    const c = Math.floor((x - this.originX) / cs);
    const r = Math.floor((z - this.originZ) / cs);
    const col = c >= 0 ? (c >= this.cols ? this.cols - 1 : c) : 0;
    const row = r >= 0 ? (r >= this.rows ? this.rows - 1 : r) : 0;
    this.cellOf[i] = row * this.cols + col;
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
    GRID_IN[0] = x;
    GRID_IN[1] = z;
    GRID_IN[2] = r;
    return this.queryCircleIn(out);
  }

  /** queryCircle() with x, z, r read from GRID_IN[0..2]. */
  queryCircleIn(out: Int32Array): number {
    const x = GRID_IN[0]!;
    const z = GRID_IN[1]!;
    const r = GRID_IN[2]!;
    const reach = r + this.maxR;
    const cs = this.cellSize;
    const ox = this.originX;
    const oz = this.originZ;
    const lastCol = this.cols - 1;
    const lastRow = this.rows - 1;
    let c0 = Math.floor((x - reach - ox) / cs);
    let c1 = Math.floor((x + reach - ox) / cs);
    let r0 = Math.floor((z - reach - oz) / cs);
    let r1 = Math.floor((z + reach - oz) / cs);
    c0 = c0 >= 0 ? (c0 > lastCol ? lastCol : c0) : 0;
    c1 = c1 >= 0 ? (c1 > lastCol ? lastCol : c1) : 0;
    r0 = r0 >= 0 ? (r0 > lastRow ? lastRow : r0) : 0;
    r1 = r1 >= 0 ? (r1 > lastRow ? lastRow : r1) : 0;
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
    GRID_IN[0] = minX;
    GRID_IN[1] = minZ;
    GRID_IN[2] = maxX;
    GRID_IN[3] = maxZ;
    return this.queryAabbIn(out);
  }

  /** queryAabb() with minX, minZ, maxX, maxZ read from GRID_IN[0..3]. */
  queryAabbIn(out: Int32Array): number {
    const minX = GRID_IN[0]!;
    const minZ = GRID_IN[1]!;
    const maxX = GRID_IN[2]!;
    const maxZ = GRID_IN[3]!;
    const m = this.maxR;
    const cs = this.cellSize;
    const ox = this.originX;
    const oz = this.originZ;
    const lastCol = this.cols - 1;
    const lastRow = this.rows - 1;
    let c0 = Math.floor((minX - m - ox) / cs);
    let c1 = Math.floor((maxX + m - ox) / cs);
    let r0 = Math.floor((minZ - m - oz) / cs);
    let r1 = Math.floor((maxZ + m - oz) / cs);
    c0 = c0 >= 0 ? (c0 > lastCol ? lastCol : c0) : 0;
    c1 = c1 >= 0 ? (c1 > lastCol ? lastCol : c1) : 0;
    r0 = r0 >= 0 ? (r0 > lastRow ? lastRow : r0) : 0;
    r1 = r1 >= 0 ? (r1 > lastRow ? lastRow : r1) : 0;
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
}

/** g.addIn(id) for the concrete grid, else g.add from GRID_IN (any SpatialGridApi). */
export function gridAddIn(g: SpatialGridApi, id: number): void {
  if (g instanceof SpatialGrid) g.addIn(id);
  else g.add(id, GRID_IN[0]!, GRID_IN[1]!, GRID_IN[2]!);
}

/** g.queryCircleIn(out) for the concrete grid, else g.queryCircle from GRID_IN. */
export function gridQueryCircleIn(g: SpatialGridApi, out: Int32Array): number {
  return g instanceof SpatialGrid
    ? g.queryCircleIn(out)
    : g.queryCircle(GRID_IN[0]!, GRID_IN[1]!, GRID_IN[2]!, out);
}

/** g.queryAabbIn(out) for the concrete grid, else g.queryAabb from GRID_IN. */
export function gridQueryAabbIn(g: SpatialGridApi, out: Int32Array): number {
  return g instanceof SpatialGrid
    ? g.queryAabbIn(out)
    : g.queryAabb(GRID_IN[0]!, GRID_IN[1]!, GRID_IN[2]!, GRID_IN[3]!, out);
}
