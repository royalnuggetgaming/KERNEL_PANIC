/**
 * Binding -> device slot lists, built once per setBindings (never on the hot path), plus the allocation-free
 * helpers the sampler and navigator use to read them.
 */
import { type Action, type KeyCode, type PlayerBindings } from '../contracts/input';
import type { KeyboardDevice } from './KeyboardDevice';

export type ActionSlots = Readonly<Record<Action, Int16Array>>;

/** Unique known slots for a list of codes (unknown codes and duplicates are dropped). */
export function slotsFor(device: KeyboardDevice, codes: readonly KeyCode[]): Int16Array {
  const out: number[] = [];
  for (const code of codes) {
    const s = device.slotOf(code);
    if (s >= 0 && !out.includes(s)) out.push(s);
  }
  return Int16Array.from(out);
}

/** Per-action slot lists for one or more binding sets merged together (solo merges both players). */
export function actionSlots(device: KeyboardDevice, sets: readonly PlayerBindings[]): ActionSlots {
  const build = (action: Action): Int16Array => {
    const codes: KeyCode[] = [];
    for (const pb of sets) codes.push(...pb[action]);
    return slotsFor(device, codes);
  };
  return {
    up: build('up'),
    down: build('down'),
    left: build('left'),
    right: build('right'),
    fire: build('fire'),
    dash: build('dash'),
    special: build('special'),
  };
}

/** True when any slot is down (suppressed keys count as up). */
export function anyDown(device: KeyboardDevice, slots: Int16Array): boolean {
  for (let i = 0; i < slots.length; i++) {
    if (device.isDown(slots[i] ?? -1)) return true;
  }
  return false;
}

/** Highest lastPressSeq among held slots, or -1 when none is held (SOCD last-wins). */
export function latestHeldSeq(device: KeyboardDevice, slots: Int16Array): number {
  let best = -1;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] ?? -1;
    if (device.isDown(s)) {
      const seq = device.lastPressSeq(s);
      if (seq > best) best = seq;
    }
  }
  return best;
}

/**
 * Consumes latched presses: true when any slot's pressCount differs from `seen[slot]` (wrap-safe), and
 * syncs `seen` for every slot in the list.
 */
export function consumePresses(device: KeyboardDevice, slots: Int16Array, seen: Uint16Array): boolean {
  let fresh = false;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] ?? -1;
    if (s < 0) continue;
    const count = device.pressCount(s);
    if (count !== seen[s]) {
      fresh = true;
      seen[s] = count;
    }
  }
  return fresh;
}

/** Marks every current press as seen (no edge survives). */
export function syncSeen(device: KeyboardDevice, seen: Uint16Array): void {
  for (let s = 0; s < seen.length; s++) seen[s] = device.pressCount(s);
}
