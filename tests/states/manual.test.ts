import { describe, expect, it } from 'vitest';
import { BOSS_IDS, ENEMY_KINDS } from '../../src/contracts/ids';
import type { Bindings } from '../../src/contracts/input';
import type { ManualPageVM } from '../../src/contracts/ui';
import { CARDS } from '../../src/config/cards';
import { DEFAULT_BINDINGS } from '../../src/config/keys';
import { META_UPGRADES } from '../../src/config/metaCatalog';
import { STAT_ROWS, TEAM_ITEMS } from '../../src/config/runCatalog';
import { createMainMenuState } from '../../src/states/MainMenuState';
import { createPausedState } from '../../src/states/PausedState';
import { buildManualPages } from '../../src/states/manualPages';
import { cardDesc, statRowDesc } from '../../src/states/powerupText';
import { manualTarget } from '../../src/states/subPanels';
import type { UiIntent } from '../../src/states/intents';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { createFakeServices } from '../helpers/fakeServices';

function text(pages: readonly ManualPageVM[]): string {
  return pages.map((p) => [p.title, ...p.blocks.map((b) => `${b.term} ${b.text}`)].join('\n')).join('\n');
}

const intent = (kind: UiIntent['kind'], itemId: string | null = null): UiIntent => ({
  player: 'any',
  kind,
  itemId,
  pointer: itemId !== null,
});

describe('HOW TO PLAY content', () => {
  const pages = buildManualPages(KERNEL_PANIC, DEFAULT_BINDINGS);
  const all = text(pages);

  it('has every required section in order', () => {
    expect(pages.map((p) => p.id)).toEqual([
      'goal',
      'controls',
      'basics',
      'link',
      'combos',
      'patchBay',
      'systems',
      'cardsA',
      'cardsB',
      'team',
      'revive',
      'enemies',
      'bosses',
      'sectors',
      'firmware',
      'versus',
      'difficulty',
      'tips',
    ]);
    for (const p of pages) expect(p.blocks.length).toBeGreaterThan(2);
    expect(all).not.toMatch(/undefined|NaN|\[object/);
  });

  it('lists every powerup with the same description as the Patch Bay', () => {
    for (const r of STAT_ROWS) expect(all).toContain(statRowDesc(r.id));
    for (const c of CARDS) {
      expect(all).toContain(c.label);
      expect(all).toContain(cardDesc(c.id));
    }
    for (const t of TEAM_ITEMS) expect(all).toContain(KERNEL_PANIC.names.teamItems[t.id]);
    for (const m of META_UPGRADES) expect(all).toContain(m.label);
  });

  it('covers every enemy kind, every boss and all three difficulties', () => {
    for (const k of ENEMY_KINDS) expect(all).toContain(KERNEL_PANIC.names.enemies[k]);
    for (const b of BOSS_IDS) expect(all).toContain(KERNEL_PANIC.names.bosses[b]);
    for (const d of ['CASUAL', 'NORMAL', 'HARD']) expect(all).toContain(d);
  });

  it('the Controls page shows the live bindings of both players', () => {
    const custom: Bindings = {
      ...DEFAULT_BINDINGS,
      players: [{ ...DEFAULT_BINDINGS.players[0], fire: ['KeyJ'] }, DEFAULT_BINDINGS.players[1]],
    };
    const controls = buildManualPages(KERNEL_PANIC, custom).find((p) => p.id === 'controls')!;
    const fire = controls.blocks.find((b) => b.term === 'Fire / Focus')!;
    expect(fire.text).toMatch(/^P1: J /);
    expect(fire.text).toContain('P2: .');
    const move = controls.blocks.find((b) => b.term === 'Move')!;
    expect(move.text).toBe('P1: W A S D   ·   P2: ↑ ← ↓ →');
  });

  it('page navigation: up/left back, down/right/confirm forward, clicks jump, clamped at both ends', () => {
    expect(manualTarget(intent('down'), 0, 5)).toBe(1);
    expect(manualTarget(intent('right'), 3, 5)).toBe(4);
    expect(manualTarget(intent('confirm'), 4, 5)).toBe(4);
    expect(manualTarget(intent('up'), 0, 5)).toBe(0);
    expect(manualTarget(intent('left'), 2, 5)).toBe(1);
    expect(manualTarget(intent('confirm', 'manual:3'), 0, 5)).toBe(3);
    expect(manualTarget(intent('confirm', 'manual:99'), 0, 5)).toBe(4);
    expect(manualTarget(intent('back'), 2, 5)).toBe(2);
  });
});

describe('HOW TO PLAY from the menus', () => {
  it('main menu: second item opens the manual; keys page through it; Back closes', () => {
    const set = createFakeServices();
    const state = createMainMenuState(set.services);
    state.enter(undefined, null);
    const frame = (): void => {
      state.update(1 / 60);
    };
    const vm = () => set.ui.vm('mainMenu')!;
    expect(
      vm()
        .items.map((i) => i.id)
        .slice(0, 3),
    ).toEqual(['play', 'manual', 'hangar']);
    expect(vm().items[1]!.label).toBe('HOW TO PLAY');
    set.input.queueMenu({ player: 'any', kind: 'down' }, { player: 'any', kind: 'confirm' });
    frame();
    expect(vm().panel).toBe('manual');
    expect(vm().manual!.page).toBe(0);
    expect(vm().manual!.pages.length).toBeGreaterThan(10);
    set.input.queueMenu({ player: 0, kind: 'down' }, { player: 1, kind: 'down' });
    frame();
    expect(vm().manual!.page).toBe(2);
    set.ui.click({ screen: 'mainMenu', kind: 'confirm', player: 'any', itemId: 'manual:5' });
    frame();
    expect(vm().manual!.page).toBe(5);
    set.input.queueMenu({ player: 'any', kind: 'back' });
    frame();
    expect(vm().panel).toBe('none');
    expect(vm().manual).toBeNull();
    expect(set.fsm.requests).toHaveLength(0);
  });

  it('pause: HOW TO PLAY opens the same manual', () => {
    const set = createFakeServices();
    set.fsm.stack = ['Playing', 'Paused'];
    const state = createPausedState(set.services);
    state.enter({ reason: 'user' }, 'Playing');
    set.ui.click({ screen: 'pause', kind: 'confirm', player: 'any', itemId: 'manual' });
    state.update(1 / 60);
    const vm = set.ui.vm('pause')!;
    expect(vm.panel).toBe('manual');
    expect(vm.manual!.pages[0]!.title).toBe('Goal');
    set.input.queueMenu({ player: 'any', kind: 'back' });
    state.update(1 / 60);
    expect(set.ui.vm('pause')!.panel).toBe('none');
    expect(set.fsm.requests).toHaveLength(0);
  });
});
