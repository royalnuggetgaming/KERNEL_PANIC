/**
 * Structural EventTarget/window doubles for engine/lifecycle.ts tests (WindowLike in docs/ARCHITECTURE.md) and
 * any other injected listener target.
 */
export interface FakeEvent {
  readonly type: string;
  defaultPrevented: boolean;
  preventDefault(): void;
}

type Fn = (e: FakeEvent) => void;

export class FakeEventTarget {
  private readonly map = new Map<string, Fn[]>();

  addEventListener(type: string, fn: Fn): void {
    const list = this.map.get(type) ?? [];
    list.push(fn);
    this.map.set(type, list);
  }

  removeEventListener(type: string, fn: Fn): void {
    const list = this.map.get(type);
    if (list)
      this.map.set(
        type,
        list.filter((f) => f !== fn),
      );
  }

  listenerCount(type?: string): number {
    if (type !== undefined) return this.map.get(type)?.length ?? 0;
    let n = 0;
    for (const l of this.map.values()) n += l.length;
    return n;
  }

  /** Dispatches an event; returns it so tests can check defaultPrevented. */
  emit(type: string): FakeEvent {
    const e: FakeEvent = {
      type,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const fn of [...(this.map.get(type) ?? [])]) fn(e);
    return e;
  }
}

export class FakeDocument extends FakeEventTarget {
  hidden = false;
  fullscreenElement: unknown = null;

  /** Sets document.hidden and fires visibilitychange. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.emit('visibilitychange');
  }
}

export class FakeWindow extends FakeEventTarget {
  readonly document = new FakeDocument();
}
