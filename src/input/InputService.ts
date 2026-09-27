/**
 * The InputPort facade over KeyboardDevice + IntentSampler + MenuNavigator (plan section 5).
 * Pure: the key event target is injected (app/ passes `window`).
 */
import type { PlayerIndex } from '../contracts/ids';
import type {
  Bindings,
  InputContext,
  InputPort,
  KeyCode,
  KeyEventTargetLike,
  MenuIntent,
  PlayerIntent,
} from '../contracts/input';
import { MENU_KEYS } from '../config/keys';
import { createIntentSampler, type IntentSampler } from './IntentSampler';
import { createKeyboardDevice, type KeyboardDevice } from './KeyboardDevice';
import { createMenuNavigator, type MenuNavigator } from './MenuNavigator';

export interface InputService extends InputPort {
  readonly device: KeyboardDevice;
  dispose(): void;
}

/** Codes that get preventDefault: every player binding, the pause keys and the shared menu keys. */
export function boundCodesOf(b: Bindings): Set<KeyCode> {
  const codes = new Set<KeyCode>();
  for (const pb of b.players) {
    for (const list of [pb.up, pb.down, pb.left, pb.right, pb.fire, pb.dash, pb.special]) {
      for (const c of list) codes.add(c);
    }
  }
  for (const c of b.pause) codes.add(c);
  for (const c of MENU_KEYS.confirm) codes.add(c);
  for (const c of MENU_KEYS.back) codes.add(c);
  return codes;
}

type CaptureCallback = (code: KeyCode | null) => void;

class InputServiceImpl implements InputService {
  readonly device: KeyboardDevice;
  private readonly sampler: IntentSampler;
  private readonly navigator: MenuNavigator;
  private readonly unsubscribe: () => void;
  private anyKey = false;
  private capture: CaptureCallback | null = null;
  private disposed = false;

  constructor(target: KeyEventTargetLike, bindings: Bindings) {
    this.device = createKeyboardDevice(target);
    this.device.setBoundCodes(boundCodesOf(bindings));
    this.sampler = createIntentSampler(this.device, bindings);
    this.navigator = createMenuNavigator(this.device, bindings);
    this.unsubscribe = this.device.onKeyDown((code) => {
      this.onFreshKey(code);
    });
  }

  get heldCodes(): ReadonlySet<KeyCode> {
    return this.device.heldCodes;
  }

  sample(p: PlayerIndex, out: PlayerIntent): void {
    this.sampler.sample(p, out);
  }

  pollMenu(frameDtMs: number, out: MenuIntent[]): number {
    return this.navigator.poll(frameDtMs, out);
  }

  consumeAnyKey(): boolean {
    const pressed = this.anyKey;
    this.anyKey = false;
    return pressed;
  }

  setContext(c: InputContext): void {
    this.navigator.setContext(c);
  }

  setSolo(solo: boolean): void {
    this.sampler.setSolo(solo);
  }

  setBindings(b: Bindings): void {
    this.device.setBoundCodes(boundCodesOf(b));
    this.sampler.setBindings(b);
    this.navigator.setBindings(b);
    this.clearEdges();
  }

  setFireModes(autofire: readonly [boolean, boolean], focusToggle: readonly [boolean, boolean]): void {
    this.sampler.setFireModes(autofire, focusToggle);
  }

  clearEdges(): void {
    this.sampler.clearEdges();
    this.navigator.clearEdges();
    this.anyKey = false;
  }

  releaseAll(): void {
    this.device.releaseAll();
  }

  suppressHeldUntilRelease(): void {
    this.device.suppressHeldUntilRelease();
  }

  captureNextKey(cb: CaptureCallback): void {
    const previous = this.capture;
    this.capture = cb;
    if (previous !== null) previous(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.device.dispose();
    const pending = this.capture;
    this.capture = null;
    if (pending !== null) pending(null);
  }

  private onFreshKey(code: KeyCode): void {
    this.anyKey = true;
    const cb = this.capture;
    if (cb === null) return;
    this.capture = null;
    // The captured press must not leak into menus or gameplay as a confirm/shot.
    this.clearEdges();
    cb(code === 'Escape' ? null : code);
  }
}

export function createInputService(deps: {
  readonly target: KeyEventTargetLike;
  readonly bindings: Bindings;
}): InputService {
  return new InputServiceImpl(deps.target, deps.bindings);
}
