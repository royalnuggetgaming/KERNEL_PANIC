/**
 * Once per 120 Hz sim tick, fills a reused PlayerIntent per player (plan section 5, LATENCY):
 * - SOCD last-pressed-wins per axis; diagonals normalised to length 1.
 * - Taps latched through pressCount (a press+release inside one tick still gives one dash / one tick of fire).
 * - Autofire and hold/toggle Focus per player.
 * - Solo: both binding sets drive P1; P2 samples as neutral.
 * Allocation-free on the sample path.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Bindings, PlayerIntent } from '../contracts/input';
import type { KeyboardDevice } from './KeyboardDevice';
import { SLOT_COUNT } from './KeyboardDevice';
import { actionSlots, anyDown, consumePresses, latestHeldSeq, syncSeen, type ActionSlots } from './slotLists';

export interface IntentSampler {
  setBindings(b: Bindings): void;
  setSolo(solo: boolean): void;
  setFireModes(autofire: readonly [boolean, boolean], focusToggle: readonly [boolean, boolean]): void;
  sample(p: PlayerIndex, out: PlayerIntent): void;
  clearEdges(): void;
}

const DIAGONAL = Math.SQRT1_2;

/** -1, 0 or +1 for one axis: the most recently pressed held direction wins. */
function axis(device: KeyboardDevice, negative: Int16Array, positive: Int16Array): number {
  const neg = latestHeldSeq(device, negative);
  const pos = latestHeldSeq(device, positive);
  if (neg < 0 && pos < 0) return 0;
  return pos > neg ? 1 : -1;
}

function neutral(out: PlayerIntent): void {
  out.moveX = 0;
  out.moveZ = 0;
  out.fireHeld = false;
  out.focusHeld = false;
  out.dashPressed = false;
  out.specialPressed = false;
}

function buildTables(device: KeyboardDevice, b: Bindings): [ActionSlots, ActionSlots, ActionSlots] {
  return [
    actionSlots(device, [b.players[0]]),
    actionSlots(device, [b.players[1]]),
    actionSlots(device, [b.players[0], b.players[1]]),
  ];
}

class IntentSamplerImpl implements IntentSampler {
  private readonly device: KeyboardDevice;
  /** Per-slot pressCount already consumed by gameplay sampling. */
  private readonly seen = new Uint16Array(SLOT_COUNT);
  /** [P1, P2, solo merge of both]. */
  private tables: readonly [ActionSlots, ActionSlots, ActionSlots];
  private solo = false;
  private readonly autofire: [boolean, boolean] = [true, true];
  private readonly focusToggle: [boolean, boolean] = [false, false];
  /** Toggle-mode Focus latch per player. */
  private readonly focusLatched: [boolean, boolean] = [false, false];

  constructor(device: KeyboardDevice, bindings: Bindings) {
    this.device = device;
    this.tables = buildTables(device, bindings);
    syncSeen(device, this.seen);
  }

  setBindings(b: Bindings): void {
    this.tables = buildTables(this.device, b);
    this.resetLatches();
  }

  setSolo(solo: boolean): void {
    if (solo === this.solo) return;
    this.solo = solo;
    this.resetLatches();
  }

  setFireModes(autofire: readonly [boolean, boolean], focusToggle: readonly [boolean, boolean]): void {
    this.autofire[0] = autofire[0];
    this.autofire[1] = autofire[1];
    this.focusToggle[0] = focusToggle[0];
    this.focusToggle[1] = focusToggle[1];
    this.resetLatches();
  }

  sample(p: PlayerIndex, out: PlayerIntent): void {
    if (this.solo && p === 1) {
      neutral(out);
      return;
    }
    const d = this.device;
    const t = this.tables[this.solo ? 2 : p];

    let x = axis(d, t.left, t.right);
    let z = axis(d, t.up, t.down);
    if (x !== 0 && z !== 0) {
      x *= DIAGONAL;
      z *= DIAGONAL;
    }
    out.moveX = x;
    out.moveZ = z;

    out.dashPressed = consumePresses(d, t.dash, this.seen);
    out.specialPressed = consumePresses(d, t.special, this.seen);

    const firePressed = consumePresses(d, t.fire, this.seen);
    const fireKey = firePressed || anyDown(d, t.fire);
    let focus: boolean;
    if (this.focusToggle[p]) {
      if (firePressed) this.focusLatched[p] = !this.focusLatched[p];
      focus = this.focusLatched[p];
    } else {
      focus = fireKey;
    }
    out.focusHeld = focus;
    out.fireHeld = this.autofire[p] || fireKey || focus;
  }

  clearEdges(): void {
    syncSeen(this.device, this.seen);
  }

  private resetLatches(): void {
    this.focusLatched[0] = false;
    this.focusLatched[1] = false;
  }
}

export function createIntentSampler(device: KeyboardDevice, bindings: Bindings): IntentSampler {
  return new IntentSamplerImpl(device, bindings);
}
