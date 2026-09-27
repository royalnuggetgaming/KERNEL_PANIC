/**
 * Low-level keyboard state (plan section 5, DEVICE). Capture-phase keydown/keyup listeners on an injected
 * KeyEventTargetLike write typed arrays immediately; consumers (IntentSampler, MenuNavigator) read them.
 *
 * - Codes map to slots through a Map prebuilt from KNOWN_CODES; unknown codes are ignored without allocating.
 * - OS repeat and IME composition never create edges. A repeat for a key believed up silently re-asserts it.
 * - Events carrying metaKey or ctrlKey are neither recorded nor prevented (OS/browser shortcuts keep working).
 *   Their keyups still release (releasing is always safe and prevents stuck keys).
 * - Meta workaround: Meta keydown releases everything and ignores non-modifier keydowns while held; Meta keyup
 *   releases everything again and requires a fresh press for every key (macOS drops keyups while Cmd is held).
 */
import { FORBIDDEN_CODES, KNOWN_CODES, MODIFIER_CODES, PREVENT_DEFAULT_EXTRA } from '../config/keys';
import type { KeyCode, KeyEventLike, KeyEventTargetLike } from '../contracts/input';

export interface KeyboardDevice {
  /** -1 for unknown codes (ignored without allocating). */
  slotOf(code: KeyCode): number;
  isDown(slot: number): boolean;
  /** Monotonic press counter per slot (tap latching: pressCount > lastSeen). */
  pressCount(slot: number): number;
  /** Global sequence number of the slot's last press (SOCD last-wins). */
  lastPressSeq(slot: number): number;
  releaseAll(): void;
  /** Keys still physically held must be released and pressed again before they count. */
  suppressHeldUntilRelease(): void;
  /** Codes that get preventDefault (bound codes; PREVENT_DEFAULT_EXTRA always). */
  setBoundCodes(codes: ReadonlySet<KeyCode>): void;
  /** Fresh non-modifier keydown notifications (captureNextKey, consumeAnyKey). Returns unsubscribe. */
  onKeyDown(cb: (code: KeyCode) => void): () => void;
  readonly heldCodes: ReadonlySet<KeyCode>;
  readonly metaHeld: boolean;
  dispose(): void;
}

/** Number of tracked slots (one per KNOWN_CODES entry). */
export const SLOT_COUNT = KNOWN_CODES.length;

const SLOT_BY_CODE = new Map<KeyCode, number>();
for (let i = 0; i < KNOWN_CODES.length; i++) {
  const code = KNOWN_CODES[i];
  if (code !== undefined && !SLOT_BY_CODE.has(code)) SLOT_BY_CODE.set(code, i);
}

const META_LEFT = SLOT_BY_CODE.get('MetaLeft') ?? -1;
const META_RIGHT = SLOT_BY_CODE.get('MetaRight') ?? -1;

/** Slots that are modifiers (ignored-while-Meta rule does not apply to them). */
const IS_MODIFIER = new Uint8Array(SLOT_COUNT);
for (const code of MODIFIER_CODES) {
  const s = SLOT_BY_CODE.get(code);
  if (s !== undefined) IS_MODIFIER[s] = 1;
}

/** Slots never reported to onKeyDown listeners (Ctrl, Meta, Alt: never bindable). */
const IS_SILENT = new Uint8Array(SLOT_COUNT);
for (const code of FORBIDDEN_CODES) {
  const s = SLOT_BY_CODE.get(code);
  if (s !== undefined) IS_SILENT[s] = 1;
}

const CAPTURE = { capture: true } as const;

class KeyboardDeviceImpl implements KeyboardDevice {
  private readonly target: KeyEventTargetLike;
  private readonly down = new Uint8Array(SLOT_COUNT);
  /** 1 = must see a keyup or a fresh keydown before the slot counts as down again. */
  private readonly suppressed = new Uint8Array(SLOT_COUNT);
  private readonly presses = new Uint16Array(SLOT_COUNT);
  private readonly pressSeq = new Uint32Array(SLOT_COUNT);
  private readonly prevent = new Uint8Array(SLOT_COUNT);
  private readonly held = new Set<KeyCode>();
  private readonly listeners: ((code: KeyCode) => void)[] = [];
  private seq = 0;
  /** Bit 0 = MetaLeft, bit 1 = MetaRight. */
  private metaMask = 0;
  private disposed = false;

  private readonly handleDown = (e: KeyEventLike): void => {
    this.keyDown(e);
  };
  private readonly handleUp = (e: KeyEventLike): void => {
    this.keyUp(e);
  };

  constructor(target: KeyEventTargetLike) {
    this.target = target;
    this.setBoundCodes(new Set<KeyCode>());
    target.addEventListener('keydown', this.handleDown, CAPTURE);
    target.addEventListener('keyup', this.handleUp, CAPTURE);
  }

  get heldCodes(): ReadonlySet<KeyCode> {
    return this.held;
  }

  get metaHeld(): boolean {
    return this.metaMask !== 0;
  }

  slotOf(code: KeyCode): number {
    return SLOT_BY_CODE.get(code) ?? -1;
  }

  isDown(slot: number): boolean {
    return slot >= 0 && slot < SLOT_COUNT && this.down[slot] === 1 && this.suppressed[slot] === 0;
  }

  pressCount(slot: number): number {
    return slot >= 0 && slot < SLOT_COUNT ? (this.presses[slot] ?? 0) : 0;
  }

  lastPressSeq(slot: number): number {
    return slot >= 0 && slot < SLOT_COUNT ? (this.pressSeq[slot] ?? 0) : 0;
  }

  releaseAll(): void {
    this.releaseKeys();
    this.metaMask = 0;
  }

  suppressHeldUntilRelease(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (this.down[i] === 1) this.suppressed[i] = 1;
    }
  }

  setBoundCodes(codes: ReadonlySet<KeyCode>): void {
    this.prevent.fill(0);
    for (const code of PREVENT_DEFAULT_EXTRA) this.markPrevent(code);
    for (const code of codes) this.markPrevent(code);
  }

  onKeyDown(cb: (code: KeyCode) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('keydown', this.handleDown, CAPTURE);
    this.target.removeEventListener('keyup', this.handleUp, CAPTURE);
    this.listeners.length = 0;
    this.releaseAll();
  }

  private markPrevent(code: KeyCode): void {
    const s = SLOT_BY_CODE.get(code);
    if (s !== undefined) this.prevent[s] = 1;
  }

  private releaseKeys(): void {
    this.down.fill(0);
    this.suppressed.fill(0);
    this.held.clear();
  }

  private keyDown(e: KeyEventLike): void {
    const slot = SLOT_BY_CODE.get(e.code);
    if (slot === undefined) return;
    if (slot === META_LEFT || slot === META_RIGHT) {
      // Cmd combos drop keyups on macOS: forget everything now, ignore keys until Meta is released.
      this.releaseKeys();
      this.metaMask |= slot === META_LEFT ? 1 : 2;
      return;
    }
    if (e.metaKey || e.ctrlKey || e.isComposing) return;
    if (this.metaMask !== 0 && IS_MODIFIER[slot] === 0) return;
    if (this.prevent[slot] === 1) e.preventDefault();
    if (e.repeat) {
      // Self-heal: a key believed up (e.g. after blur) is re-asserted without an edge.
      if (this.down[slot] === 0 && this.suppressed[slot] === 0) this.setHeld(slot, e.code);
      return;
    }
    this.suppressed[slot] = 0;
    this.setHeld(slot, e.code);
    this.presses[slot] = ((this.presses[slot] ?? 0) + 1) & 0xffff;
    this.seq = (this.seq + 1) >>> 0;
    this.pressSeq[slot] = this.seq;
    if (IS_SILENT[slot] === 1) return;
    const ls = this.listeners;
    for (let i = 0; i < ls.length; i++) {
      const cb = ls[i];
      if (cb !== undefined) cb(e.code);
    }
  }

  private keyUp(e: KeyEventLike): void {
    const slot = SLOT_BY_CODE.get(e.code);
    if (slot === undefined) return;
    if (slot === META_LEFT || slot === META_RIGHT) {
      this.metaMask &= slot === META_LEFT ? ~1 : ~2;
      this.releaseKeys();
      // Keys still physically held must be pressed again (their keyups may have been dropped).
      this.suppressed.fill(1);
      return;
    }
    if (!e.metaKey && !e.ctrlKey && this.prevent[slot] === 1) e.preventDefault();
    this.suppressed[slot] = 0;
    if (this.down[slot] === 1) {
      this.down[slot] = 0;
      this.held.delete(e.code);
    }
  }

  private setHeld(slot: number, code: KeyCode): void {
    if (this.down[slot] === 1) return;
    this.down[slot] = 1;
    this.held.add(code);
  }
}

export function createKeyboardDevice(target: KeyEventTargetLike): KeyboardDevice {
  return new KeyboardDeviceImpl(target);
}
