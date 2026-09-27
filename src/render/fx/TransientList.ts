/**
 * Fixed-capacity list of short-lived visual records (chain arcs, telegraph decals) with dense swap-remove
 * expiry. Preallocated structs; add() never allocates and overwrites the oldest record when full.
 */
export interface Transient {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Start time (uTime clock). */
  t0: number;
  life: number;
  size: number;
  kind: number;
  tint: number;
  seed: number;
}

function blank(): Transient {
  return { x0: 0, z0: 0, x1: 0, z1: 0, t0: 0, life: 0, size: 0, kind: 0, tint: 0, seed: 0 };
}

export class TransientList {
  readonly capacity: number;
  readonly items: Transient[] = [];
  private n = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    for (let i = 0; i < capacity; i++) this.items.push(blank());
  }

  get count(): number {
    return this.n;
  }

  /** Returns a record to fill (every field). When full, the oldest (smallest t0) is reused. */
  add(): Transient {
    if (this.n < this.capacity) return this.items[this.n++]!;
    let oldest = 0;
    for (let i = 1; i < this.n; i++) if (this.items[i]!.t0 < this.items[oldest]!.t0) oldest = i;
    return this.items[oldest]!;
  }

  /** Removes records whose age exceeds their life. */
  expire(now: number): void {
    const it = this.items;
    for (let i = this.n - 1; i >= 0; i--) {
      const r = it[i]!;
      if (now - r.t0 <= r.life) continue;
      const last = --this.n;
      if (i !== last) {
        it[i] = it[last]!;
        it[last] = r;
      }
    }
  }

  clear(): void {
    this.n = 0;
  }
}
