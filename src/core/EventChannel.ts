/**
 * Fixed-capacity channel of preallocated mutable structs. push() returns a struct to fill in place;
 * on overflow a scratch struct is returned (not recorded) and `dropped` is incremented.
 */
import type { EventChannel as EventChannelApi } from '../contracts/simEvents';

export class EventChannel<T extends object> implements EventChannelApi<T> {
  readonly capacity: number;
  private readonly items: T[];
  private readonly scratch: T;
  private n = 0;
  private droppedCount = 0;

  constructor(capacity: number, factory: () => T) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`EventChannel: invalid capacity ${String(capacity)}`);
    }
    this.capacity = capacity;
    this.items = new Array<T>(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = factory();
    this.scratch = factory();
  }

  get count(): number {
    return this.n;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  push(): T {
    if (this.n >= this.capacity) {
      this.droppedCount++;
      return this.scratch;
    }
    return this.items[this.n++]!;
  }

  get(i: number): Readonly<T> {
    if (i < 0 || i >= this.n)
      throw new RangeError(`EventChannel.get: ${String(i)} not in [0, ${String(this.n)})`);
    return this.items[i]!;
  }

  clear(): void {
    this.n = 0;
  }

  /** Resets the overflow counter (tests/perf probes). */
  resetDropped(): void {
    this.droppedCount = 0;
  }
}
