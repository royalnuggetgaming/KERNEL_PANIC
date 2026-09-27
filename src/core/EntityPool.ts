/**
 * Preallocated generational pool with a dense swap-remove active array. Zero allocation after construction.
 */
import type { EntityHandle } from '../contracts/ids';
import type { EntityPoolApi, PooledRecord } from '../contracts/sim';

interface MutablePooled {
  slot: number;
  gen: number;
  di: number;
  seq: number;
}

/** Base fields for a record factory: `(slot) => ({ ...pooledBase(slot), x: 0, ... })`. */
export function pooledBase(slot: number): { slot: number; gen: number; di: number; seq: number } {
  return { slot, gen: 0, di: -1, seq: 0 };
}

export class EntityPool<T extends PooledRecord> implements EntityPoolApi<T> {
  readonly capacity: number;
  private readonly records: T[];
  private readonly dense: T[];
  private readonly freeSlots: Int32Array;
  private freeTop: number;
  private liveCount = 0;
  private nextSeq = 1;
  private exhaustedCount = 0;

  /** factory(slot) must return a fully-initialised record whose `slot` equals the argument. */
  constructor(capacity: number, factory: (slot: number) => T) {
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity > 0x7fffff) {
      throw new RangeError(`EntityPool: invalid capacity ${String(capacity)}`);
    }
    this.capacity = capacity;
    this.records = new Array<T>(capacity);
    this.dense = new Array<T>(capacity);
    this.freeSlots = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      const rec = factory(i);
      const m = rec as unknown as MutablePooled;
      m.slot = i;
      m.gen = 0;
      m.di = -1;
      m.seq = 0;
      this.records[i] = rec;
      this.dense[i] = rec;
      // Pop order yields slot 0 first.
      this.freeSlots[i] = capacity - 1 - i;
    }
    this.freeTop = capacity;
  }

  get count(): number {
    return this.liveCount;
  }

  get active(): readonly T[] {
    return this.dense;
  }

  get exhausted(): number {
    return this.exhaustedCount;
  }

  spawn(): T | null {
    if (this.freeTop === 0) {
      this.exhaustedCount++;
      return null;
    }
    const slot = this.freeSlots[--this.freeTop]!;
    const rec = this.records[slot]!;
    const m = rec as unknown as MutablePooled;
    m.gen = (m.gen + 1) & 0xff;
    m.di = this.liveCount;
    m.seq = this.nextSeq++;
    this.dense[this.liveCount++] = rec;
    return rec;
  }

  spawnRecycling(): T {
    const rec = this.spawn();
    if (rec !== null) return rec;
    let oldest = this.dense[0]!;
    for (let i = 1; i < this.liveCount; i++) {
      const r = this.dense[i]!;
      if (r.seq < oldest.seq) oldest = r;
    }
    this.despawn(oldest);
    // A slot is free now, so spawn() cannot fail; exhausted was already counted above.
    return this.spawn()!;
  }

  despawn(rec: T): void {
    const m = rec as unknown as MutablePooled;
    const di = m.di;
    if (di < 0 || this.dense[di] !== rec) return;
    const lastIndex = --this.liveCount;
    const last = this.dense[lastIndex]!;
    this.dense[di] = last;
    (last as unknown as MutablePooled).di = di;
    this.dense[lastIndex] = rec;
    m.di = -1;
    this.freeSlots[this.freeTop++] = m.slot;
  }

  atSlot(slot: number): T {
    const rec = this.records[slot];
    if (rec === undefined) throw new RangeError(`EntityPool.atSlot: ${String(slot)} out of range`);
    return rec;
  }

  isAlive(rec: T): boolean {
    return rec.di >= 0;
  }

  handleOf(rec: T): EntityHandle {
    return rec.slot * 256 + (rec.gen & 0xff);
  }

  resolve(h: EntityHandle): T | null {
    if (h < 0) return null;
    const slot = Math.floor(h / 256);
    const rec = this.records[slot];
    if (rec === undefined || rec.di < 0 || (rec.gen & 0xff) !== h % 256) return null;
    return rec;
  }

  clear(): void {
    for (let i = this.liveCount - 1; i >= 0; i--) this.despawn(this.dense[i]!);
    // Restore the construction-time free order so a cleared pool hands out slots exactly like a fresh one.
    const capacity = this.freeSlots.length;
    for (let i = 0; i < capacity; i++) this.freeSlots[i] = capacity - 1 - i;
    this.freeTop = capacity;
    this.exhaustedCount = 0;
  }
}
