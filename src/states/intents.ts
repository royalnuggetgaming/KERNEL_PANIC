/**
 * Shared menu-intent plumbing for states: keyboard MenuIntents (InputPort.pollMenu into a reused buffer) and
 * mouse PointerIntents (UiPort.onPointerIntent, queued while the state is active) merged into one stream of
 * UiIntents, keyboard first. Pointer itemId conventions are documented at the top of src/ui/pointer.ts.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { InputPort, MenuIntent, MenuIntentKind } from '../contracts/input';
import type { PointerIntent, ScreenId, UiPort } from '../contracts/ui';

/** One menu intent from either device. `itemId` is non-null only for pointer intents that target an item. */
export interface UiIntent {
  player: PlayerIndex | 'any';
  kind: MenuIntentKind;
  itemId: string | null;
  pointer: boolean;
}

const MENU_BUFFER = 16;

function blankMenuIntent(): MenuIntent {
  return { player: 'any', kind: 'up' };
}

/**
 * Reads the frame's intents. open() subscribes to pointer intents for one screen (others are ignored);
 * close() unsubscribes and drops anything queued. The returned UiIntent objects are reused between calls.
 */
export class IntentReader {
  private readonly menu: MenuIntent[] = Array.from({ length: MENU_BUFFER }, blankMenuIntent);
  private readonly out: UiIntent[] = [];
  private pointerQueue: PointerIntent[] = [];
  private unsubscribe: (() => void) | null = null;
  private screens: readonly ScreenId[] = [];

  open(ui: UiPort, ...screens: ScreenId[]): void {
    this.close();
    this.screens = screens;
    this.unsubscribe = ui.onPointerIntent((i) => {
      if (this.screens.includes(i.screen)) this.pointerQueue.push(i);
    });
  }

  close(): void {
    if (this.unsubscribe !== null) this.unsubscribe();
    this.unsubscribe = null;
    this.pointerQueue = [];
  }

  /** Polls keyboard intents (always) and drains queued pointer intents. Valid until the next read(). */
  read(input: InputPort, frameDtMs: number): readonly UiIntent[] {
    const n = input.pollMenu(frameDtMs, this.menu);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const m = this.menu[i]!;
      this.write(count++, m.player, m.kind, null, false);
    }
    const q = this.pointerQueue;
    for (let i = 0; i < q.length; i++) {
      const p = q[i]!;
      this.write(count++, p.player, p.kind, p.itemId, true);
    }
    q.length = 0;
    this.out.length = count;
    return this.out;
  }

  private write(
    i: number,
    player: PlayerIndex | 'any',
    kind: MenuIntentKind,
    itemId: string | null,
    pointer: boolean,
  ): void {
    const slot = this.out[i];
    if (slot === undefined) {
      this.out[i] = { player, kind, itemId, pointer };
      return;
    }
    slot.player = player;
    slot.kind = kind;
    slot.itemId = itemId;
    slot.pointer = pointer;
  }
}

/** Cursor step with wrap-around over [0, count). */
export function wrapIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** Cursor clamp into [0, count). */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, index), count - 1);
}

/** Index of the item with this id, or -1. */
export function indexOfId(items: readonly { readonly id: string }[], id: string | null): number {
  if (id === null) return -1;
  for (let i = 0; i < items.length; i++) if (items[i]!.id === id) return i;
  return -1;
}
