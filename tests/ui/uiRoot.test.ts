import { describe, expect, it } from 'vitest';
import type { PointerIntent } from '../../src/contracts/ui';
import type { Settings } from '../../src/contracts/save';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { TOAST_MAX, TOAST_MS } from '../../src/ui/Toasts';
import { createUiRoot, createUiRootWithClock, paletteVars } from '../../src/ui/UIRoot';
import { FakeDocument, asDocument, asElement, type FakeElement } from './fakeDom';
import { bootVM, gameOverVM, hudVM, mainMenuVM, pauseVM, shopVM } from './fixtures';

const SETTINGS: Settings = {
  master: 1,
  music: 0.8,
  sfx: 0.8,
  quality: 'high',
  frameCap: 'auto',
  screenShake: 1,
  reduceFlashes: false,
  reduceMotion: false,
  colorblind: false,
  autofire: [true, true],
  focusToggle: [false, false],
  showFps: false,
  themeId: 'kernelPanic',
};

function setup() {
  const fdoc = new FakeDocument();
  const root = fdoc.createElement('div');
  let t = 1000;
  const ui = createUiRootWithClock({ root: asElement(root), theme: KERNEL_PANIC, doc: asDocument(fdoc) }, () => t);
  const layer = root.children[0]!;
  const screen = (id: string): FakeElement => layer.byAttr('data-screen', id)[0]!;
  return {
    ui,
    root,
    layer,
    screen,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('ui/UIRoot', () => {
  it('builds every screen once, hidden', () => {
    const { layer, screen } = setup();
    for (const id of ['boot', 'mainMenu', 'characterSelect', 'hud', 'shop', 'hangar', 'pause', 'gameOver']) {
      expect(screen(id)).toBeDefined();
      expect(screen(id).hidden).toBe(true);
    }
    expect(layer.classList.contains('kp-ui')).toBe(true);
  });

  it('queues DOM writes until flush', () => {
    const { ui, screen } = setup();
    ui.show('boot', bootVM());
    expect(screen('boot').hidden).toBe(true);
    expect(screen('boot').first('kp-boot-pct').textContent).toBe('');
    ui.flush();
    expect(screen('boot').hidden).toBe(false);
    expect(screen('boot').first('kp-boot-pct').textContent).toBe('40%');
    expect(screen('boot').first('kp-title').textContent).toBe('KERNEL PANIC');

    ui.update('boot', bootVM({ phase: 'ready' }));
    expect(screen('boot').first('kp-boot-ready').hidden).toBe(true);
    ui.flush();
    expect(screen('boot').first('kp-boot-ready').hidden).toBe(false);
    expect(screen('boot').first('kp-boot-loading').hidden).toBe(true);

    ui.hide('boot');
    expect(screen('boot').hidden).toBe(false);
    ui.flush();
    expect(screen('boot').hidden).toBe(true);
  });

  it('skips re-rendering an identical VM', () => {
    const { ui, screen } = setup();
    const vm = mainMenuVM();
    ui.show('mainMenu', vm);
    ui.flush();
    const title = screen('mainMenu').first('kp-title');
    const writes = title.textWrites;
    ui.update('mainMenu', vm);
    ui.flush();
    ui.update('mainMenu', mainMenuVM());
    ui.flush();
    expect(title.textWrites).toBe(writes);
  });

  it('renders the menu with cursor, disabled items and cores', () => {
    const { ui, screen } = setup();
    ui.show('mainMenu', mainMenuVM({ cursor: 1 }));
    ui.flush();
    const items = screen('mainMenu').byClass('kp-menu-item');
    expect(items.length).toBe(4);
    expect(items[1]!.classList.contains('is-cursor')).toBe(true);
    expect(items[0]!.classList.contains('is-cursor')).toBe(false);
    expect(items[3]!.classList.contains('is-disabled')).toBe(true);
    expect(items[3]!.getAttribute('aria-disabled')).toBe('true');
    expect(screen('mainMenu').first('kp-menu-hint').textContent).toBe('Permanent upgrades');
    expect(screen('mainMenu').first('kp-cores-num').textContent).toBe('1,234');
  });

  it('maps clicks to PointerIntents and prevents mousedown focus', () => {
    const { ui, screen } = setup();
    const got: PointerIntent[] = [];
    const off = ui.onPointerIntent((i) => got.push(i));
    ui.show('mainMenu', mainMenuVM());
    ui.flush();
    const items = screen('mainMenu').byClass('kp-menu-item');
    const label = items[0]!.first('kp-menu-label');
    expect(label.dispatch('mousedown').defaultPrevented).toBe(true);
    const click = label.dispatch('click');
    expect(click.defaultPrevented).toBe(true);
    expect(got).toEqual([{ screen: 'mainMenu', kind: 'confirm', player: 'any', itemId: 'play' }]);
    items[3]!.dispatch('click');
    expect(got.length).toBe(1);
    screen('mainMenu').first('kp-title').dispatch('click');
    expect(got.length).toBe(1);
    off();
    label.dispatch('click');
    expect(got.length).toBe(1);
  });

  it('boot screen click anywhere is a confirm', () => {
    const { ui, screen } = setup();
    const got: PointerIntent[] = [];
    ui.onPointerIntent((i) => got.push(i));
    ui.show('boot', bootVM({ phase: 'ready' }));
    ui.flush();
    screen('boot').first('kp-boot-ready').dispatch('click');
    expect(got).toEqual([{ screen: 'boot', kind: 'confirm', player: 'any', itemId: 'boot' }]);
  });

  it('applySettings writes palette variables and accessibility classes', () => {
    const { ui, layer } = setup();
    expect(layer.style.getPropertyValue('--kp-p1')).toBe('#19e6ff');
    expect(layer.style.getPropertyValue('--kp-p2')).toBe('#ff3fd0');
    ui.applySettings({ ...SETTINGS, colorblind: true, reduceMotion: true, reduceFlashes: true });
    expect(layer.style.getPropertyValue('--kp-p2')).toBe('#ff9a1f');
    expect(layer.style.getPropertyValue('--kp-p2-rgb')).toBe('255, 154, 31');
    expect(layer.classList.contains('kp-reduce-motion')).toBe(true);
    expect(layer.classList.contains('kp-reduce-flashes')).toBe(true);
    expect(layer.classList.contains('kp-colorblind')).toBe(true);
    ui.applySettings(SETTINGS);
    expect(layer.style.getPropertyValue('--kp-p2')).toBe('#ff3fd0');
    expect(layer.classList.contains('kp-reduce-motion')).toBe(false);
  });

  it('paletteVars comes from the theme', () => {
    const vars = new Map(paletteVars(KERNEL_PANIC, false));
    expect(vars.get('--kp-bg')).toBe('#05060d');
    expect(vars.get('--kp-accent')).toBe('#19e6ff');
    expect(vars.get('--kp-danger')).toBe('#ff5a1f');
  });

  it('toasts keep at most 3 and expire on flush', () => {
    const { ui, layer, advance } = setup();
    const toasts = layer.first('kp-toasts');
    const visible = () => toasts.children.filter((c) => !c.hidden).map((c) => c.textContent);
    ui.toast('one', 'info');
    ui.toast('two', 'warn');
    ui.flush();
    expect(visible()).toEqual(['one', 'two']);
    advance(1000);
    ui.toast('three', 'error');
    ui.toast('four', 'info');
    ui.flush();
    expect(visible()).toEqual(['two', 'three', 'four']);
    expect(visible().length).toBe(TOAST_MAX);
    expect(toasts.children[1]!.classList.contains('kind-error')).toBe(true);
    advance(TOAST_MS - 999);
    ui.flush();
    expect(visible()).toEqual(['three', 'four']);
    advance(TOAST_MS);
    ui.flush();
    expect(visible()).toEqual([]);
  });

  it('paints overlays above the HUD and base screens', () => {
    const { layer } = setup();
    const order = layer.children.map((c) => c.getAttribute('data-screen') ?? c.className);
    expect(order.indexOf('hud')).toBeLessThan(order.indexOf('gameOver'));
    expect(order.indexOf('shop')).toBeLessThan(order.indexOf('pause'));
    expect(order[order.length - 1]).toBe('kp-toasts');
  });

  it('keeps several screens visible (HUD under the shop under pause)', () => {
    const { ui, screen } = setup();
    ui.show('hud', hudVM());
    ui.show('shop', shopVM());
    ui.show('pause', pauseVM());
    ui.flush();
    expect(screen('hud').hidden).toBe(false);
    expect(screen('shop').hidden).toBe(false);
    expect(screen('pause').hidden).toBe(false);
    ui.hide('pause');
    ui.flush();
    expect(screen('pause').hidden).toBe(true);
    expect(screen('shop').hidden).toBe(false);
  });

  it('update on a hidden screen is kept for the next show', () => {
    const { ui, screen } = setup();
    ui.update('gameOver', gameOverVM({ title: 'EARLY' }));
    ui.flush();
    expect(screen('gameOver').hidden).toBe(true);
    ui.show('gameOver', gameOverVM({ title: 'LATE' }));
    ui.flush();
    expect(screen('gameOver').first('kp-go-title').textContent).toBe('LATE');
  });

  it('dispose detaches listeners and the layer', () => {
    const { ui, root, layer } = setup();
    expect(layer.listenerCount('click')).toBe(1);
    ui.dispose();
    ui.dispose();
    expect(layer.listenerCount('click')).toBe(0);
    expect(layer.listenerCount('mousedown')).toBe(0);
    expect(root.children.length).toBe(0);
    ui.show('boot', bootVM());
    ui.flush();
  });

  it('createUiRoot works without a window (Date.now clock)', () => {
    const fdoc = new FakeDocument();
    const root = fdoc.createElement('div');
    const ui = createUiRoot({ root: asElement(root), theme: KERNEL_PANIC, doc: asDocument(fdoc) });
    ui.show('hud', hudVM());
    ui.flush();
    expect(root.children[0]!.byAttr('data-screen', 'hud')[0]!.hidden).toBe(false);
  });
});
