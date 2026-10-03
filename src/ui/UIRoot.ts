/**
 * UiPort implementation. Every screen is built once at creation (hidden) and toggled afterwards. show/update/hide
 * only record the latest VM and visibility; flush() (once per frame) applies them: visibility diffs, then a
 * diffed render of each visible screen whose VM changed or which asked for another pass (HUD text throttle,
 * shop flashes). Mouse clicks resolve to PointerIntents through data attributes (ui/pointer.ts).
 */
import type { Settings } from '../contracts/save';
import type { PointerIntent, ScreenId, ScreenVMs, ToastKind, UiPort } from '../contracts/ui';
import type { ThemeDef } from '../contracts/theme';
import type { ScreenView, ScreenViews, UiContext } from './view';
import { Flag, h } from './dom';
import { formatHexColor, formatRgbTriplet } from './format';
import { isPointerNode, resolvePointerIntent, SCREEN_IDS } from './pointer';
import { Toasts } from './Toasts';
import { Hud } from './hud/Hud';
import { BootScreen } from './screens/BootScreen';
import { CharacterSelectScreen } from './screens/CharacterSelectScreen';
import { GameOverScreen } from './screens/GameOverScreen';
import { HangarScreen } from './screens/HangarScreen';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { PauseScreen } from './screens/PauseScreen';
import { ShopScreen } from './screens/ShopScreen';

export interface UiRootDeps {
  readonly root: HTMLElement;
  readonly theme: ThemeDef;
  readonly doc: Document;
}

export interface UiRoot extends UiPort {
  /** Palette CSS variables from the theme; reduce-motion class. */
  applySettings(s: Settings): void;
  dispose(): void;
}

/** Monotonic milliseconds for throttles and toasts. */
export type UiClock = () => number;

interface ScreenSlot {
  vm: ScreenVMs[ScreenId] | null;
  /** Requested visibility (applied on flush). */
  want: boolean;
  /** Applied visibility. */
  shown: boolean;
  dirty: boolean;
  /** The view asked for another render without a new VM. */
  again: boolean;
}

/** Theme palette -> CSS custom properties on the UI root. */
export function paletteVars(theme: ThemeDef, colorblind: boolean): readonly (readonly [string, string])[] {
  const p = theme.palette;
  const p2 = colorblind ? p.p2Colorblind : p.p2;
  // UI chrome keeps the theme's signature cyan; the sector accents are world colours (walls, pylons, fx) and are
  // chosen to stay off the player hues, so they no longer match the UI.
  const accent = p.p1;
  return [
    ['--kp-bg', formatHexColor(p.ui.bg)],
    ['--kp-panel', formatHexColor(p.ui.panel)],
    ['--kp-text', formatHexColor(p.ui.text)],
    ['--kp-dim', formatHexColor(p.ui.dim)],
    ['--kp-p1', formatHexColor(p.p1)],
    ['--kp-p2', formatHexColor(p2)],
    ['--kp-accent', formatHexColor(accent)],
    ['--kp-danger', formatHexColor(p.enemyShot)],
    ['--kp-good', formatHexColor(p.pickup)],
    ['--kp-link', formatHexColor(p.link)],
    ['--kp-p1-rgb', formatRgbTriplet(p.p1)],
    ['--kp-p2-rgb', formatRgbTriplet(p2)],
    ['--kp-accent-rgb', formatRgbTriplet(accent)],
    ['--kp-danger-rgb', formatRgbTriplet(p.enemyShot)],
    ['--kp-panel-rgb', formatRgbTriplet(p.ui.panel)],
    ['--kp-bg-rgb', formatRgbTriplet(p.ui.bg)],
  ];
}

function emptySlot(): ScreenSlot {
  return { vm: null, want: false, shown: false, dirty: false, again: false };
}

function defaultClock(doc: Document): UiClock {
  const perf = doc.defaultView?.performance;
  if (perf !== undefined) return () => perf.now();
  return () => Date.now();
}

export function createUiRoot(deps: UiRootDeps): UiRoot {
  return createUiRootWithClock(deps, defaultClock(deps.doc));
}

/** createUiRoot with an injected clock (tests). */
export function createUiRootWithClock(deps: UiRootDeps, now: UiClock): UiRoot {
  const { root, theme, doc } = deps;
  const ctx: UiContext = { doc, theme };
  const views: ScreenViews = {
    boot: new BootScreen(ctx),
    mainMenu: new MainMenuScreen(ctx),
    characterSelect: new CharacterSelectScreen(ctx),
    hud: new Hud(ctx),
    shop: new ShopScreen(ctx),
    hangar: new HangarScreen(ctx),
    pause: new PauseScreen(ctx),
    gameOver: new GameOverScreen(ctx),
  };
  const slots: Readonly<Record<ScreenId, ScreenSlot>> = {
    boot: emptySlot(),
    mainMenu: emptySlot(),
    characterSelect: emptySlot(),
    hud: emptySlot(),
    shop: emptySlot(),
    hangar: emptySlot(),
    pause: emptySlot(),
    gameOver: emptySlot(),
  };

  const toasts = new Toasts(doc);
  const layer = h(doc, 'div', { className: 'kp-ui' });
  // Paint order: HUD at the bottom, then full screens, overlays (shop, pause) and toasts on top.
  const order: readonly ScreenId[] = [
    'hud',
    'boot',
    'mainMenu',
    'characterSelect',
    'hangar',
    'gameOver',
    'shop',
    'pause',
  ];
  for (const id of order) layer.appendChild(views[id].el);
  layer.appendChild(toasts.el);
  root.appendChild(layer);

  const reduceMotion = new Flag(layer, 'kp-reduce-motion');
  const reduceFlashes = new Flag(layer, 'kp-reduce-flashes');
  const colorblind = new Flag(layer, 'kp-colorblind');
  const setPalette = (cb: boolean): void => {
    const vars = paletteVars(theme, cb);
    for (let i = 0; i < vars.length; i++) layer.style.setProperty(vars[i]![0], vars[i]![1]);
  };
  setPalette(false);

  let callbacks: ((i: PointerIntent) => void)[] = [];
  const onMouseDown = (e: Event): void => {
    // Keep focus on the page: DOM buttons must never take focus (Space/Enter would re-activate them).
    e.preventDefault();
  };
  const onClick = (e: Event): void => {
    const target = e.target;
    if (!isPointerNode(target)) return;
    const intent = resolvePointerIntent(target, layer);
    if (intent === null) return;
    e.preventDefault();
    const list = callbacks;
    for (let i = 0; i < list.length; i++) list[i]!(intent);
  };
  layer.addEventListener('mousedown', onMouseDown);
  layer.addEventListener('click', onClick);

  function renderView<S extends ScreenId>(id: S, vm: ScreenVMs[S], t: number): boolean {
    const view: ScreenView<S> = views[id];
    return view.render(vm, t);
  }

  function showView(id: ScreenId): void {
    const view = views[id];
    if (view.onShow !== undefined) view.onShow();
  }

  let disposed = false;

  return {
    show<S extends ScreenId>(s: S, vm: ScreenVMs[S]): void {
      const slot = slots[s];
      slot.vm = vm;
      slot.want = true;
      slot.dirty = true;
    },
    update<S extends ScreenId>(s: S, vm: ScreenVMs[S]): void {
      const slot = slots[s];
      if (slot.vm === vm) return;
      slot.vm = vm;
      slot.dirty = true;
    },
    hide(s: ScreenId): void {
      slots[s].want = false;
    },
    toast(msg: string, kind: ToastKind, durationMs?: number): void {
      toasts.push(msg, kind, now(), durationMs);
    },
    onPointerIntent(cb: (i: PointerIntent) => void): () => void {
      callbacks = callbacks.concat(cb);
      return () => {
        callbacks = callbacks.filter((c) => c !== cb);
      };
    },
    flush(): void {
      if (disposed) return;
      const t = now();
      for (let i = 0; i < SCREEN_IDS.length; i++) {
        const id = SCREEN_IDS[i]!;
        const slot = slots[id];
        if (slot.want !== slot.shown) {
          if (slot.want) {
            showView(id);
            slot.dirty = true;
          }
          slot.shown = slot.want;
          // Render before unhiding so a screen never shows a frame of stale content.
          if (!slot.want) views[id].el.hidden = true;
        }
        if (slot.shown && slot.vm !== null && (slot.dirty || slot.again)) {
          slot.dirty = false;
          slot.again = renderView(id, slot.vm, t);
          if (views[id].el.hidden) views[id].el.hidden = false;
        }
      }
      toasts.flush(t);
    },
    applySettings(s: Settings): void {
      reduceMotion.set(s.reduceMotion);
      reduceFlashes.set(s.reduceFlashes);
      if (s.colorblind !== colorblind.value) {
        colorblind.set(s.colorblind);
        setPalette(s.colorblind);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      callbacks = [];
      layer.removeEventListener('mousedown', onMouseDown);
      layer.removeEventListener('click', onClick);
      if (layer.parentNode === root) root.removeChild(layer);
    },
  };
}
