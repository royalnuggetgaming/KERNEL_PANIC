import { describe, expect, it } from 'vitest';
import type { Bindings } from '../../src/contracts/input';
import type { Settings } from '../../src/contracts/save';
import { adjustSetting, buildSettingsVM, SETTING_IDS } from '../../src/states/settingsPanel';
import { SubPanelController } from '../../src/states/subPanels';
import { TEST_SETTINGS } from '../helpers/fakeSave';
import { bootToMenu, createHarness, type Harness } from './harness';

async function openPanel(item: 'settings' | 'controls'): Promise<Harness> {
  const h = createHarness();
  await bootToMenu(h);
  h.set.ui.click({ screen: 'mainMenu', kind: 'confirm', player: 'any', itemId: item });
  h.frame();
  return h;
}

function lastSettingsPatch(h: Harness): Partial<Settings> | undefined {
  const call = h.set.save.rec.last('commitDebounced');
  return (call?.args[0] as { settings?: Partial<Settings> } | undefined)?.settings;
}

function lastBindings(h: Harness): Bindings | undefined {
  const call = h.set.input.rec.last('setBindings');
  return call?.args[0] as Bindings | undefined;
}

describe('Settings sub-panel', () => {
  it('adjusts, saves through commitDebounced and applies live', async () => {
    const h = await openPanel('settings');
    const { ui, audio, render, input } = h.set;
    expect(ui.vm('mainMenu')?.panel).toBe('settings');
    h.press({ player: 'any', kind: 'right' });
    expect(lastSettingsPatch(h)).toEqual({ master: 0.9 });
    expect(audio.rec.last('setVolumes')?.args).toEqual([0.9, 0.7, 0.8]);
    expect(ui.vm('mainMenu')?.settings?.rows[0]?.value).toBe('90%');
    ui.click({ screen: 'mainMenu', kind: 'confirm', player: 'any', itemId: 'colorblind' });
    h.frame();
    expect(lastSettingsPatch(h)).toEqual({ colorblind: true });
    expect((render.rec.last('applySettings')?.args[0] as Settings).colorblind).toBe(true);
    ui.click({ screen: 'mainMenu', kind: 'confirm', player: 'any', itemId: 'autofire1' });
    h.frame();
    expect(input.rec.last('setFireModes')?.args).toEqual([
      [true, false],
      [false, false],
    ]);
    ui.click({ screen: 'mainMenu', kind: 'left', player: 'any', itemId: 'quality' });
    h.frame();
    expect(lastSettingsPatch(h)).toEqual({ quality: 'medium' });
    ui.click({ screen: 'mainMenu', kind: 'confirm', player: 'any', itemId: 'theme' });
    h.frame();
    expect(ui.vm('mainMenu')?.settings?.note).toBe('Only one theme is installed.');
    h.press({ player: 'any', kind: 'back' });
    expect(ui.vm('mainMenu')?.panel).toBe('none');
  });

  it('adjustSetting covers every row; sliders clamp to [0, 1]', () => {
    for (const id of SETTING_IDS) adjustSetting(TEST_SETTINGS, id, 1);
    expect(adjustSetting({ ...TEST_SETTINGS, sfx: 1 }, 'sfx', 1)).toBeNull();
    expect(adjustSetting({ ...TEST_SETTINGS, screenShake: 0 }, 'screenShake', -1)).toBeNull();
    expect(adjustSetting(TEST_SETTINGS, 'frameCap', 1)).toEqual({ frameCap: 60 });
    expect(adjustSetting({ ...TEST_SETTINGS, frameCap: 'auto' }, 'frameCap', -1)).toEqual({
      frameCap: 'uncapped',
    });
    expect(adjustSetting(TEST_SETTINGS, 'focus0', 1)).toEqual({ focusToggle: [true, false] });
    expect(adjustSetting(TEST_SETTINGS, 'autofire0', 1)).toEqual({ autofire: [false, true] });
    const vm = buildSettingsVM({ ...TEST_SETTINGS, frameCap: 120, focusToggle: [true, true] }, 3, 'n');
    expect(vm.rows.find((r) => r.id === 'frameCap')?.value).toBe('120 FPS');
    expect(vm.rows.find((r) => r.id === 'focus1')?.value).toBe('TOGGLE');
    expect(vm.rows).toHaveLength(SETTING_IDS.length);
  });
});

describe('Controls sub-panel (rebinding)', () => {
  it('captures the next key, validates and saves', async () => {
    const h = await openPanel('controls');
    const { input, ui, save } = h.set;
    h.press({ player: 'any', kind: 'confirm' });
    expect(input.rec.count('captureNextKey')).toBe(1);
    expect(input.context).toBe('rebind');
    expect(ui.vm('mainMenu')?.controls?.capturing).toEqual({ player: 0, action: 'up' });
    input.capture('KeyI');
    h.frame();
    expect(input.context).toBe('menu');
    expect(lastBindings(h)?.players[0].up).toEqual(['KeyI', 'KeyW']);
    const saved = save.rec.last('commitDebounced')?.args[0] as { bindings?: Bindings };
    expect(saved.bindings?.players[0].up[0]).toBe('KeyI');
    expect(ui.vm('mainMenu')?.controls?.players[0][0]?.keys[0]?.label).toBe('I');
  });

  it('rejects forbidden and reserved keys, cancels on Escape', async () => {
    const h = await openPanel('controls');
    const { input, ui } = h.set;
    h.press({ player: 'any', kind: 'confirm' });
    input.capture('MetaLeft');
    h.frame();
    expect(ui.vm('mainMenu')?.controls?.message).toContain('Cmd');
    h.press({ player: 'any', kind: 'confirm' });
    input.capture('KeyP');
    h.frame();
    expect(ui.vm('mainMenu')?.controls?.message).toContain('reserved');
    h.press({ player: 'any', kind: 'confirm' });
    input.capture(null);
    h.frame();
    expect(ui.vm('mainMenu')?.controls?.message).toBe('Rebind cancelled.');
    expect(input.rec.count('setBindings')).toBe(1);
  });

  it('offers a swap when the key is bound elsewhere; confirm swaps, back cancels', async () => {
    const h = await openPanel('controls');
    const { input, ui } = h.set;
    h.press({ player: 'any', kind: 'confirm' });
    input.capture('KeyS');
    h.frame();
    expect(ui.vm('mainMenu')?.controls?.swapOffer).toContain('P1 DOWN');
    // Back cancels the swap without closing the panel.
    h.press({ player: 'any', kind: 'back' });
    expect(ui.vm('mainMenu')?.panel).toBe('controls');
    expect(ui.vm('mainMenu')?.controls?.swapOffer).toBeNull();
    h.press({ player: 'any', kind: 'confirm' });
    input.capture('KeyS');
    h.frame();
    h.press({ player: 'any', kind: 'confirm' });
    const b = lastBindings(h);
    expect(b?.players[0].up).toEqual(['KeyS']);
    expect(b?.players[0].down).toEqual(['KeyW']);
  });

  it('mouse rebinding targets the clicked player row; P2 column via left/right', async () => {
    const h = await openPanel('controls');
    const { input, ui } = h.set;
    ui.click({ screen: 'mainMenu', kind: 'confirm', player: 1, itemId: 'fire' });
    h.frame();
    expect(ui.vm('mainMenu')?.controls?.capturing).toEqual({ player: 1, action: 'fire' });
    input.capture('KeyM');
    h.frame();
    expect(lastBindings(h)?.players[1].fire[0]).toBe('KeyM');
    expect(ui.vm('mainMenu')?.controls?.cursor).toEqual({ player: 1, row: 4 });
    h.press({ player: 'any', kind: 'right' });
    expect(ui.vm('mainMenu')?.controls?.cursor.player).toBe(0);
  });

  it('key test shows held keys and the max, and only a shared back ends it', async () => {
    const h = await openPanel('controls');
    const { input, ui } = h.set;
    h.press({ player: 'any', kind: 'up' });
    h.press({ player: 'any', kind: 'confirm' });
    expect(ui.vm('mainMenu')?.controls?.keyTest.active).toBe(true);
    input.held.add('KeyW');
    input.held.add('KeyD');
    input.held.add('Space');
    h.frame();
    expect(ui.vm('mainMenu')?.controls?.keyTest.maxSimultaneous).toBe(3);
    expect(ui.vm('mainMenu')?.controls?.keyTest.held.map((k) => k.code)).toEqual(['KeyW', 'KeyD', 'Space']);
    input.held.clear();
    h.press({ player: 0, kind: 'back' }, { player: 0, kind: 'down' });
    expect(ui.vm('mainMenu')?.controls?.keyTest.active).toBe(true);
    h.press({ player: 'any', kind: 'back' });
    expect(ui.vm('mainMenu')?.controls?.keyTest.active).toBe(false);
    expect(ui.vm('mainMenu')?.panel).toBe('controls');
    ui.click({ screen: 'mainMenu', kind: 'confirm', player: 'any', itemId: 'keyTest' });
    h.frame();
    expect(ui.vm('mainMenu')?.controls?.keyTest.active).toBe(true);
    ui.click({ screen: 'mainMenu', kind: 'confirm', player: 'any', itemId: 'keyTest' });
    h.frame();
    expect(ui.vm('mainMenu')?.controls?.keyTest.active).toBe(false);
    ui.click({ screen: 'mainMenu', kind: 'back', player: 'any', itemId: 'back' });
    h.frame();
    expect(ui.vm('mainMenu')?.panel).toBe('none');
  });

  it('a capture that completes after the panel closed is ignored; intents wait while capturing', async () => {
    const h = await openPanel('controls');
    const { input } = h.set;
    h.press({ player: 'any', kind: 'confirm' });
    h.press({ player: 'any', kind: 'confirm' }, { player: 'any', kind: 'back' });
    expect(input.rec.count('captureNextKey')).toBe(1);
    expect(h.set.ui.vm('mainMenu')?.panel).toBe('controls');
    const panels = new SubPanelController(h.services);
    panels.open('controls');
    panels.handle({ player: 'any', kind: 'confirm', itemId: null, pointer: false });
    panels.close();
    expect(input.context).toBe('menu');
    input.capture('KeyI');
    expect(input.rec.count('setBindings')).toBe(1);
  });

  it('credits panel opens and closes', async () => {
    const h = await openPanel('settings');
    h.press({ player: 'any', kind: 'back' });
    h.press({ player: 'any', kind: 'down' }, { player: 'any', kind: 'down' });
    h.press({ player: 'any', kind: 'confirm' });
    expect(h.set.ui.vm('mainMenu')?.panel).toBe('credits');
    expect(h.set.ui.vm('mainMenu')?.credits.length).toBeGreaterThan(0);
    h.press({ player: 'any', kind: 'back' });
    expect(h.set.ui.vm('mainMenu')?.panel).toBe('none');
  });
});
