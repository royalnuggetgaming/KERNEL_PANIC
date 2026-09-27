/**
 * Keyboard code tables and default bindings (plan section 5). Lives in config (not input/) so that save/
 * (sanitize) and input/ can both use it without a sibling import.
 */
import type { Bindings, KeyCode, PlayerBindings } from '../contracts/input';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`);
const DIGITS = '0123456789'.split('').map((d) => `Digit${d}`);
const NUMPAD_DIGITS = '0123456789'.split('').map((d) => `Numpad${d}`);

export const MODIFIER_CODES: readonly KeyCode[] = [
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
];

/** Every code the device tracks (a prebuilt code -> slot map; unknown codes are ignored). */
export const KNOWN_CODES: readonly KeyCode[] = [
  ...LETTERS,
  ...DIGITS,
  ...NUMPAD_DIGITS,
  'NumpadDecimal',
  'NumpadEnter',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
  'Escape',
  'Backspace',
  'Tab',
  'CapsLock',
  'Comma',
  'Period',
  'Slash',
  'Semicolon',
  'Quote',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Minus',
  'Equal',
  'Backquote',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'Delete',
  ...MODIFIER_CODES,
];

/** Never valid in bindings: Ctrl/Cmd/Option are eaten by macOS or the browser. */
export const FORBIDDEN_CODES: readonly KeyCode[] = [
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'AltLeft',
  'AltRight',
];

/** Reserved for pause. */
export const RESERVED_CODES: readonly KeyCode[] = ['Escape', 'KeyP'];

/** preventDefault is also called for these even when unbound (scroll, quick-find, back-navigation). */
export const PREVENT_DEFAULT_EXTRA: readonly KeyCode[] = [
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'Backspace',
  'Slash',
  'Quote',
];

export const P1_DEFAULT_BINDINGS: PlayerBindings = {
  up: ['KeyW'],
  left: ['KeyA'],
  down: ['KeyS'],
  right: ['KeyD'],
  fire: ['Space', 'KeyF'],
  dash: ['ShiftLeft', 'KeyQ'],
  special: ['KeyE', 'KeyR'],
};

export const P2_DEFAULT_BINDINGS: PlayerBindings = {
  up: ['ArrowUp', 'Numpad8'],
  left: ['ArrowLeft', 'Numpad4'],
  down: ['ArrowDown', 'Numpad5', 'Numpad2'],
  right: ['ArrowRight', 'Numpad6'],
  fire: ['Period', 'Numpad0'],
  dash: ['Slash', 'ShiftRight', 'NumpadDecimal'],
  special: ['Comma', 'NumpadEnter'],
};

export const DEFAULT_BINDINGS: Bindings = {
  players: [P1_DEFAULT_BINDINGS, P2_DEFAULT_BINDINGS],
  pause: ['Escape', 'KeyP'],
};

/** Shared menu keys (not tied to a player). Player keys map via their bindings (fire=confirm, dash=back). */
export const MENU_KEYS = {
  confirm: ['Enter', 'NumpadEnter'],
  back: ['Backspace', 'Escape'],
  pause: ['Escape', 'KeyP'],
  debug: ['Backquote'],
} as const;

export const MENU_REPEAT = { delayMs: 350, intervalMs: 90 } as const;

const SPECIAL_LABELS: Readonly<Record<string, string>> = {
  Space: 'SPACE',
  Enter: 'ENTER',
  Escape: 'ESC',
  Backspace: 'BKSP',
  Tab: 'TAB',
  CapsLock: 'CAPS',
  ShiftLeft: 'L-SHIFT',
  ShiftRight: 'R-SHIFT',
  ControlLeft: 'L-CTRL',
  ControlRight: 'R-CTRL',
  AltLeft: 'L-OPT',
  AltRight: 'R-OPT',
  MetaLeft: 'L-CMD',
  MetaRight: 'R-CMD',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  NumpadDecimal: 'NUM .',
  NumpadEnter: 'NUM ENTER',
  NumpadAdd: 'NUM +',
  NumpadSubtract: 'NUM -',
  NumpadMultiply: 'NUM *',
  NumpadDivide: 'NUM /',
  PageUp: 'PG UP',
  PageDown: 'PG DN',
  Insert: 'INS',
  Delete: 'DEL',
  Home: 'HOME',
  End: 'END',
};

/** Short keycap label for a code (UI view models). */
export function keyLabel(code: KeyCode): string {
  const special = SPECIAL_LABELS[code];
  if (special !== undefined) return special;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}
