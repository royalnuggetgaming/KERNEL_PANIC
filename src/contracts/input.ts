/**
 * Input contracts. Keyboard only, bindings use KeyboardEvent.code.
 * FROZEN after Wave 0.
 */
import type { PlayerIndex } from './ids';

/** A KeyboardEvent.code value, validated against KNOWN_CODES (config/keys.ts). */
export type KeyCode = string;

export const ACTIONS = ['up', 'down', 'left', 'right', 'fire', 'dash', 'special'] as const;
export type Action = (typeof ACTIONS)[number];

export type PlayerBindings = Readonly<Record<Action, readonly KeyCode[]>>;

export interface Bindings {
  readonly players: readonly [PlayerBindings, PlayerBindings];
  /** Global pause keys (Escape, KeyP). Reserved: never valid in player bindings. */
  readonly pause: readonly KeyCode[];
}

/**
 * Per-player gameplay intent for ONE sim tick. Mutable and reused: the sampler overwrites it in place.
 * moveX/moveZ are screen-relative (+X right, +Z toward the camera/bottom of screen), length <= 1.
 */
export interface PlayerIntent {
  moveX: number;
  moveZ: number;
  /** Shooting this tick (autofire on => always true while alive unless focus-only rules say otherwise). */
  fireHeld: boolean;
  /** FIRE/FOCUS held (or toggled on): locks facing, tightens spread, +damage, slows movement. */
  focusHeld: boolean;
  /** Latched edge: at most one dash per press, even for press+release inside one tick. */
  dashPressed: boolean;
  /** Latched edge. */
  specialPressed: boolean;
}

export type Intents = readonly [PlayerIntent, PlayerIntent];

export type MenuIntentKind = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'ready' | 'pause';

/**
 * Menu intent. `player` is 0/1 when the key belongs to that player's binding set
 * (move keys -> directions, fire -> confirm, dash -> back, special -> ready) and 'any' for
 * shared keys (Enter/NumpadEnter -> confirm, Backspace -> back, Escape -> back in 'menu' context,
 * Escape/KeyP -> pause in 'gameplay' context). Shared menus ignore `player`.
 */
export interface MenuIntent {
  readonly player: PlayerIndex | 'any';
  readonly kind: MenuIntentKind;
}

export interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
  preventDefault(): void;
}

export type KeyEventType = 'keydown' | 'keyup';

export interface KeyEventTargetLike {
  addEventListener(type: KeyEventType, fn: (e: KeyEventLike) => void, opts: { capture: true }): void;
  removeEventListener(type: KeyEventType, fn: (e: KeyEventLike) => void, opts: { capture: true }): void;
}

export type InputContext = 'menu' | 'gameplay' | 'rebind';

export interface InputPort {
  /** Once per sim tick per player. Consumes that player's latched edges. */
  sample(p: PlayerIndex, out: PlayerIntent): void;
  /**
   * Once per frame. Writes up to out.length intents (software repeat 350 ms then 90 ms; OS repeat ignored)
   * into `out` starting at index 0 and returns the count. In 'gameplay' context only 'pause' intents are produced.
   */
  pollMenu(frameDtMs: number, out: MenuIntent[]): number;
  /** True once if any non-modifier key was freshly pressed since the last call (Boot "press any key"). */
  consumeAnyKey(): boolean;
  setContext(c: InputContext): void;
  /** Solo: both binding sets drive P1 in gameplay. Menus are unaffected. */
  setSolo(solo: boolean): void;
  setBindings(b: Bindings): void;
  setFireModes(autofire: readonly [boolean, boolean], focusToggle: readonly [boolean, boolean]): void;
  clearEdges(): void;
  releaseAll(): void;
  suppressHeldUntilRelease(): void;
  readonly heldCodes: ReadonlySet<KeyCode>;
  /** Rebind flow: the next non-modifier keydown (or null on Escape/cancel) is delivered once. */
  captureNextKey(cb: (code: KeyCode | null) => void): void;
  /** Text pasted from the clipboard (Ctrl/Cmd+V) while subscribed (TERMINAL). Returns unsubscribe. v3, optional. */
  onPaste?(cb: (text: string) => void): () => void;
}
