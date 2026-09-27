/**
 * Menu intents (plan section 5, MENUS). Once per frame, turns fresh presses into MenuIntents and applies software
 * repeat to held directions (MENU_REPEAT: 350 ms delay, then every 90 ms), per player independently. OS repeat
 * events are ignored because the device never counts them as presses.
 *
 * Mapping ('menu' context): each player's move keys -> directions, fire -> confirm, dash -> back,
 * special -> ready (tagged with that player); shared keys Enter/NumpadEnter -> confirm, Backspace/Escape -> back,
 * the remaining pause keys (KeyP) -> pause (tagged 'any'). 'gameplay' context: only pause keys -> pause.
 * 'rebind' context: nothing (the rebind flow captures keys through captureNextKey).
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Bindings, InputContext, KeyCode, MenuIntent, MenuIntentKind } from '../contracts/input';
import { MENU_KEYS, MENU_REPEAT } from '../config/keys';
import type { KeyboardDevice } from './KeyboardDevice';
import { anyDown, slotsFor } from './slotLists';

export interface MenuNavigator {
  setBindings(b: Bindings): void;
  setContext(c: InputContext): void;
  poll(frameDtMs: number, out: MenuIntent[]): number;
  clearEdges(): void;
}

interface Source {
  readonly intent: MenuIntent;
  readonly slots: Int16Array;
  /** pressCount already consumed, per entry of `slots`. */
  readonly seen: Uint16Array;
  readonly repeat: boolean;
  /** Held since a fresh press seen by this navigator (only armed sources repeat). */
  armed: boolean;
  heldMs: number;
  nextRepeatMs: number;
}

function makeSource(
  device: KeyboardDevice,
  player: PlayerIndex | 'any',
  kind: MenuIntentKind,
  codes: readonly KeyCode[],
): Source {
  const slots = slotsFor(device, codes);
  const seen = new Uint16Array(slots.length);
  for (let i = 0; i < slots.length; i++) seen[i] = device.pressCount(slots[i] ?? -1);
  const repeat = kind === 'up' || kind === 'down' || kind === 'left' || kind === 'right';
  const intent: MenuIntent = Object.freeze({ player, kind });
  return { intent, slots, seen, repeat, armed: false, heldMs: 0, nextRepeatMs: 0 };
}

function buildMenuSources(device: KeyboardDevice, b: Bindings): Source[] {
  const sources: Source[] = [];
  const players: readonly PlayerIndex[] = [0, 1];
  for (const p of players) {
    const pb = b.players[p];
    sources.push(
      makeSource(device, p, 'up', pb.up),
      makeSource(device, p, 'down', pb.down),
      makeSource(device, p, 'left', pb.left),
      makeSource(device, p, 'right', pb.right),
      makeSource(device, p, 'confirm', pb.fire),
      makeSource(device, p, 'back', pb.dash),
      makeSource(device, p, 'ready', pb.special),
    );
  }
  const backCodes: readonly KeyCode[] = MENU_KEYS.back;
  sources.push(
    makeSource(device, 'any', 'confirm', MENU_KEYS.confirm),
    makeSource(device, 'any', 'back', backCodes),
    makeSource(
      device,
      'any',
      'pause',
      b.pause.filter((c) => !backCodes.includes(c)),
    ),
  );
  return sources;
}

function buildGameplaySources(device: KeyboardDevice, b: Bindings): Source[] {
  return [makeSource(device, 'any', 'pause', b.pause)];
}

/** Consumes the source's latched presses; true when any entry was freshly pressed. */
function consume(device: KeyboardDevice, src: Source): boolean {
  let fresh = false;
  const slots = src.slots;
  for (let i = 0; i < slots.length; i++) {
    const count = device.pressCount(slots[i] ?? -1);
    if (count !== src.seen[i]) {
      src.seen[i] = count;
      fresh = true;
    }
  }
  return fresh;
}

function resetSource(device: KeyboardDevice, src: Source): void {
  const slots = src.slots;
  for (let i = 0; i < slots.length; i++) src.seen[i] = device.pressCount(slots[i] ?? -1);
  src.armed = false;
  src.heldMs = 0;
  src.nextRepeatMs = 0;
}

class MenuNavigatorImpl implements MenuNavigator {
  private readonly device: KeyboardDevice;
  private menuSources: Source[];
  private gameplaySources: Source[];
  private context: InputContext = 'menu';

  constructor(device: KeyboardDevice, bindings: Bindings) {
    this.device = device;
    this.menuSources = buildMenuSources(device, bindings);
    this.gameplaySources = buildGameplaySources(device, bindings);
  }

  setBindings(b: Bindings): void {
    this.menuSources = buildMenuSources(this.device, b);
    this.gameplaySources = buildGameplaySources(this.device, b);
  }

  setContext(c: InputContext): void {
    if (c === this.context) return;
    this.context = c;
    this.clearEdges();
  }

  poll(frameDtMs: number, out: MenuIntent[]): number {
    const d = this.device;
    if (this.context === 'rebind') {
      this.clearEdges();
      return 0;
    }
    const sources = this.context === 'menu' ? this.menuSources : this.gameplaySources;
    const dt = frameDtMs > 0 && Number.isFinite(frameDtMs) ? frameDtMs : 0;
    const cap = out.length;
    let n = 0;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (src === undefined) continue;
      const fresh = consume(d, src);
      const held = anyDown(d, src.slots);
      let emit = false;
      if (fresh) {
        emit = true;
        src.armed = held && src.repeat;
        src.heldMs = 0;
        src.nextRepeatMs = MENU_REPEAT.delayMs;
      } else if (src.armed && held) {
        src.heldMs += dt;
        if (src.heldMs >= src.nextRepeatMs) {
          emit = true;
          src.nextRepeatMs += MENU_REPEAT.intervalMs;
          // A long frame repeats once, never in a burst.
          if (src.nextRepeatMs <= src.heldMs) src.nextRepeatMs = src.heldMs + MENU_REPEAT.intervalMs;
        }
      } else if (!held) {
        src.armed = false;
      }
      if (emit && n < cap) out[n++] = src.intent;
    }
    return n;
  }

  clearEdges(): void {
    const d = this.device;
    for (let i = 0; i < this.menuSources.length; i++) {
      const src = this.menuSources[i];
      if (src !== undefined) resetSource(d, src);
    }
    for (let i = 0; i < this.gameplaySources.length; i++) {
      const src = this.gameplaySources[i];
      if (src !== undefined) resetSource(d, src);
    }
  }
}

export function createMenuNavigator(device: KeyboardDevice, bindings: Bindings): MenuNavigator {
  return new MenuNavigatorImpl(device, bindings);
}
