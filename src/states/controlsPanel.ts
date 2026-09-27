/**
 * Controls sub-panel controller: per-player rebinding with the capture-next-key flow, validation through
 * config/bindings (forbidden Ctrl/Cmd/Option, reserved Escape/KeyP, every action keeps a code), a swap offer
 * when the captured code is bound elsewhere, and the Key Test rollover readout.
 *
 * Keyboard: up/down move within a player's column, left/right switch columns, confirm starts a capture.
 * The row after the last action is KEY TEST (confirm toggles it). While the Key Test runs, every intent except
 * a shared back (Escape/Backspace) is ignored, because both players are pressing their gameplay keys.
 */
import { PLAYER_INDICES, type PlayerIndex } from '../contracts/ids';
import { ACTIONS, type Action, type Bindings, type KeyCode } from '../contracts/input';
import type { Services } from '../contracts/services';
import type { ControlsPanelVM, ControlsRowVM, KeyCapVM } from '../contracts/ui';
import { proposeSwap, validateBindings } from '../config/bindings';
import { keyLabel } from '../config/keys';
import { wrapIndex, type UiIntent } from './intents';

const ACTION_LABELS: Readonly<Record<Action, string>> = {
  up: 'UP',
  down: 'DOWN',
  left: 'LEFT',
  right: 'RIGHT',
  fire: 'FIRE / FOCUS',
  dash: 'DASH',
  special: 'SPECIAL',
};

/** Cursor row of the KEY TEST pseudo-row. */
export const KEY_TEST_ROW = ACTIONS.length;
const ROW_COUNT = ACTIONS.length + 1;

export const KEY_TEST_PROMPT =
  'Both players: hold W+D+SPACE and ↑+→+. together. If a key drops out, rebind it or turn autofire on.';

const REJECT_TEXT = {
  forbidden: 'Ctrl, Cmd and Option cannot be bound (macOS eats them).',
  reserved: 'Escape and P are reserved for pause.',
  menu: 'Enter and Backspace are reserved for menus.',
  unknown: 'That key is not supported.',
} as const;

function playerName(p: PlayerIndex): string {
  return p === 0 ? 'P1' : 'P2';
}

function isAction(x: string | null): x is Action {
  return x !== null && (ACTIONS as readonly string[]).includes(x);
}

export class ControlsController {
  cursorPlayer: PlayerIndex = 0;
  cursorRow = 0;
  capturing: { readonly player: PlayerIndex; readonly action: Action } | null = null;
  swapOffer: string | null = null;
  message = '';
  keyTest = false;
  maxHeld = 0;
  private bindings: Bindings;
  private pendingSwap: Bindings | null = null;
  /** Invalidates capture callbacks that arrive after the panel closed. */
  private captureToken = 0;
  private readonly s: Services;
  /** Called when an asynchronous capture result changed the VM. */
  onChange: () => void = () => undefined;

  constructor(s: Services) {
    this.s = s;
    this.bindings = s.save.data.bindings;
  }

  open(): void {
    this.bindings = this.s.save.data.bindings;
    this.cursorPlayer = 0;
    this.cursorRow = 0;
    this.capturing = null;
    this.swapOffer = null;
    this.pendingSwap = null;
    this.message = '';
    this.keyTest = false;
    this.maxHeld = 0;
  }

  /** Cancels a running capture and the key test (panel closed or state exited). */
  close(): void {
    this.captureToken++;
    if (this.capturing !== null) this.s.input.setContext('menu');
    this.capturing = null;
    this.pendingSwap = null;
    this.swapOffer = null;
    this.keyTest = false;
  }

  get current(): Bindings {
    return this.bindings;
  }

  /** True while this controller owns every intent (capture, swap offer or key test). */
  get modal(): boolean {
    return this.capturing !== null || this.pendingSwap !== null || this.keyTest;
  }

  /** Returns true when the VM changed. `back` closes the panel only when this returns false and !modal. */
  handle(i: UiIntent): boolean {
    if (this.capturing !== null) return false;
    if (this.pendingSwap !== null) return this.handleSwap(i);
    if (this.keyTest) {
      const endTest = (i.kind === 'back' && i.player === 'any') || (i.pointer && i.itemId === 'keyTest');
      if (!endTest) return false;
      this.keyTest = false;
      this.message = '';
      return true;
    }
    if (i.pointer) return this.handlePointer(i);
    switch (i.kind) {
      case 'up':
      case 'down':
        this.cursorRow = wrapIndex(this.cursorRow, i.kind === 'up' ? -1 : 1, ROW_COUNT);
        this.message = this.cursorRow === KEY_TEST_ROW ? 'KEY TEST: press confirm to start.' : '';
        this.s.audio.play('uiMove');
        return true;
      case 'left':
      case 'right':
        this.cursorPlayer = this.cursorPlayer === 0 ? 1 : 0;
        this.s.audio.play('uiMove');
        return true;
      case 'confirm':
        if (this.cursorRow === KEY_TEST_ROW) return this.startKeyTest();
        return this.startCapture(this.cursorPlayer, ACTIONS[this.cursorRow]!);
      case 'back':
      case 'ready':
      case 'pause':
        return false;
    }
  }

  /** Per-frame refresh while the key test is live (held keys change without intents). */
  tick(): boolean {
    if (!this.keyTest) return false;
    const held = this.s.input.heldCodes.size;
    if (held > this.maxHeld) this.maxHeld = held;
    return true;
  }

  vm(): ControlsPanelVM {
    const held = this.s.input.heldCodes;
    const players: [ControlsRowVM[], ControlsRowVM[]] = [[], []];
    for (const p of PLAYER_INDICES) {
      const pb = this.bindings.players[p];
      for (const action of ACTIONS) {
        players[p].push({
          action,
          label: ACTION_LABELS[action],
          keys: pb[action].map((code) => capOf(code, held.has(code))),
        });
      }
    }
    const heldCaps: KeyCapVM[] = [];
    if (this.keyTest) for (const code of held) heldCaps.push(capOf(code, true));
    return {
      players,
      cursor: { player: this.cursorPlayer, row: this.cursorRow },
      capturing: this.capturing,
      swapOffer: this.swapOffer,
      keyTest: {
        active: this.keyTest,
        held: heldCaps,
        maxSimultaneous: this.maxHeld,
        prompt: KEY_TEST_PROMPT,
      },
      message: this.message,
    };
  }

  private handlePointer(i: UiIntent): boolean {
    if (i.kind !== 'confirm') return false;
    if (i.itemId === 'keyTest') return this.startKeyTest();
    if (!isAction(i.itemId) || i.player === 'any') return false;
    this.cursorPlayer = i.player;
    this.cursorRow = ACTIONS.indexOf(i.itemId);
    return this.startCapture(i.player, i.itemId);
  }

  private handleSwap(i: UiIntent): boolean {
    if (i.kind === 'confirm' && this.pendingSwap !== null) {
      this.commit(this.pendingSwap, 'Swapped.');
      return true;
    }
    if (i.kind === 'back') {
      this.pendingSwap = null;
      this.swapOffer = null;
      this.message = 'Swap cancelled.';
      this.s.audio.play('uiBack');
      return true;
    }
    return false;
  }

  private startKeyTest(): boolean {
    this.keyTest = true;
    this.maxHeld = 0;
    this.message = 'KEY TEST: Escape or Backspace ends it.';
    this.s.audio.play('uiConfirm');
    return true;
  }

  private startCapture(player: PlayerIndex, action: Action): boolean {
    this.capturing = { player, action };
    this.swapOffer = null;
    this.message = `${playerName(player)} ${ACTION_LABELS[action]}: press a key (Escape cancels).`;
    const token = ++this.captureToken;
    this.s.input.setContext('rebind');
    this.s.input.captureNextKey((code) => {
      if (token !== this.captureToken) return;
      this.captured(player, action, code);
      this.onChange();
    });
    this.s.audio.play('uiConfirm');
    return true;
  }

  private captured(player: PlayerIndex, action: Action, code: KeyCode | null): void {
    this.capturing = null;
    this.s.input.setContext('menu');
    if (code === null) {
      this.message = 'Rebind cancelled.';
      return;
    }
    const r = proposeSwap(this.bindings, player, action, code);
    if (!r.ok) {
      this.message = REJECT_TEXT[r.reason];
      this.s.audio.play('uiDeny');
      return;
    }
    if (r.swappedWith !== null) {
      const other = r.swappedWith;
      this.pendingSwap = r.bindings;
      this.swapOffer =
        `${keyLabel(code)} is bound to ${playerName(other.player)} ${ACTION_LABELS[other.action]}. ` +
        'Confirm to swap, Back to cancel.';
      this.message = '';
      return;
    }
    this.commit(r.bindings, `${playerName(player)} ${ACTION_LABELS[action]} = ${keyLabel(code)}`);
  }

  private commit(next: Bindings, message: string): void {
    this.pendingSwap = null;
    this.swapOffer = null;
    const errors = validateBindings(next);
    if (errors.length > 0) {
      this.message = 'That binding would leave the controls invalid.';
      this.s.audio.play('uiDeny');
      return;
    }
    this.bindings = next;
    this.s.input.setBindings(next);
    this.s.save.commitDebounced({ bindings: next });
    this.message = message;
    this.s.audio.play('uiConfirm');
  }
}

function capOf(code: KeyCode, held: boolean): KeyCapVM {
  return { code, label: keyLabel(code), held };
}
