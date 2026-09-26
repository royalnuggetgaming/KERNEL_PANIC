/** KeyEventTargetLike double: dispatch synthetic keydown/keyup and observe preventDefault. */
import type { KeyEventLike, KeyEventTargetLike, KeyEventType } from '../../src/contracts/input';

export interface KeyInit {
  readonly code: string;
  readonly repeat?: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly isComposing?: boolean;
}

type Listener = (e: KeyEventLike) => void;

export class FakeKeyTarget implements KeyEventTargetLike {
  private readonly listeners: Record<KeyEventType, Listener[]> = { keydown: [], keyup: [] };
  /** Every dispatched event and whether it was prevented. */
  readonly log: { type: KeyEventType; code: string; prevented: boolean }[] = [];

  /** The contract's `{ capture: true }` type already forces capture-phase registration. */
  addEventListener(type: KeyEventType, fn: Listener, _opts: { capture: true }): void {
    this.listeners[type].push(fn);
  }

  removeEventListener(type: KeyEventType, fn: Listener, _opts: { capture: true }): void {
    this.listeners[type] = this.listeners[type].filter((l) => l !== fn);
  }

  listenerCount(type: KeyEventType): number {
    return this.listeners[type].length;
  }

  /** Dispatches one event; returns true when a listener called preventDefault(). */
  dispatch(type: KeyEventType, init: KeyInit): boolean {
    let prevented = false;
    const e: KeyEventLike = {
      code: init.code,
      repeat: init.repeat ?? false,
      metaKey: init.metaKey ?? false,
      ctrlKey: init.ctrlKey ?? false,
      isComposing: init.isComposing ?? false,
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const l of [...this.listeners[type]]) l(e);
    this.log.push({ type, code: init.code, prevented });
    return prevented;
  }

  down(code: string, opts: Omit<KeyInit, 'code'> = {}): boolean {
    return this.dispatch('keydown', { ...opts, code });
  }

  up(code: string, opts: Omit<KeyInit, 'code'> = {}): boolean {
    return this.dispatch('keyup', { ...opts, code });
  }

  /** keydown immediately followed by keyup (a tap inside one tick). */
  tap(code: string): void {
    this.down(code);
    this.up(code);
  }

  /** OS auto-repeat keydown. */
  repeat(code: string): boolean {
    return this.dispatch('keydown', { code, repeat: true });
  }
}
