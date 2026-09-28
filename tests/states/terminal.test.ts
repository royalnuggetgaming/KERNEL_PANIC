import { describe, expect, it } from 'vitest';
import type { KeyCode } from '../../src/contracts/input';
import { createGameOverState } from '../../src/states/GameOverState';
import { cheatsBanner, runCheatIds } from '../../src/states/cheatState';
import { SubPanelController } from '../../src/states/subPanels';
import { keyChar } from '../../src/states/terminal';
import { FakeRunSession, testRunConfig } from '../helpers/fakeRun';
import { createTestSaveData, FakeSaveStore } from '../helpers/fakeSave';
import { createFakeServices } from '../helpers/fakeServices';

function typeText(set: ReturnType<typeof createFakeServices>, text: string): void {
  for (const ch of text) {
    const code = (ch === ' ' ? 'Space' : /[0-9]/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`) as KeyCode;
    set.input.capture(code);
  }
}

function rig() {
  const set = createFakeServices();
  const panels = new SubPanelController(set.services);
  panels.open('terminal');
  return { set, panels };
}

describe('TERMINAL', () => {
  it('maps only letters, digits and space to text', () => {
    expect(keyChar('KeyQ')).toBe('Q');
    expect(keyChar('Digit7')).toBe('7');
    expect(keyChar('Numpad3')).toBe('3');
    expect(keyChar('Space')).toBe(' ');
    expect(keyChar('ArrowUp')).toBeNull();
    expect(keyChar('Escape')).toBeNull();
  });

  it('captures keys in the rebind context (no game or menu intents while typing)', () => {
    const { set } = rig();
    expect(set.input.context).toBe('rebind');
    typeText(set, 'idd');
    expect(set.input.context).toBe('rebind');
  });

  it('a right code (any case) unlocks and enables the cheat; a wrong one is ACCESS DENIED', () => {
    const { set, panels } = rig();
    typeText(set, 'nope');
    set.input.capture('Enter');
    expect(panels.terminalVM()?.lines.at(-1)).toMatch(/ACCESS DENIED/);
    expect(panels.terminalVM()?.flash).toBe('denied');
    typeText(set, 'iddqd');
    expect(panels.terminalVM()?.input).toBe('IDDQD');
    set.input.capture('Enter');
    const vm = panels.terminalVM()!;
    expect(vm.flash).toBe('granted');
    expect(set.save.data.cheats).toEqual({ unlocked: ['god'], enabled: ['god'] });
    expect(vm.cheats.map((c) => [c.label, c.enabled])).toEqual([['GOD MODE', true]]);
    expect(vm.warning).toMatch(/no Cores/);
  });

  it('Backspace edits, Up + Enter on an empty prompt toggles, OFF switches all off, Escape closes', () => {
    const { set, panels } = rig();
    typeText(set, 'TURBOX');
    set.input.capture('Backspace');
    set.input.capture('Enter');
    expect(set.save.data.cheats?.enabled).toEqual(['turbo']);
    set.input.capture('ArrowUp');
    set.input.capture('Enter');
    expect(set.save.data.cheats?.enabled).toEqual([]);
    expect(set.save.data.cheats?.unlocked).toEqual(['turbo']);
    set.input.capture('Enter'); // still on the row: toggles back on
    expect(set.save.data.cheats?.enabled).toEqual(['turbo']);
    typeText(set, 'off');
    set.input.capture('ArrowDown');
    set.input.capture('Enter');
    expect(set.save.data.cheats?.enabled).toEqual([]);
    set.input.capture(null);
    panels.tick();
    expect(panels.panel).toBe('none');
    expect(set.input.context).toBe('menu');
  });

  it('clicking a cheat row toggles it', () => {
    const { set, panels } = rig();
    typeText(set, 'bitrain');
    set.input.capture('Enter');
    panels.handle({ kind: 'confirm', player: 'any', pointer: true, itemId: 'cheat:bitRain' });
    expect(set.save.data.cheats?.enabled).toEqual([]);
  });
});

describe('cheat runs', () => {
  const save = createTestSaveData({ cheats: { unlocked: ['god', 'turbo'], enabled: ['turbo', 'god'] } });

  it('snapshot enabled cheats in CHEAT_IDS order, never in versus, and say so in character select', () => {
    expect(runCheatIds(save, 'coop')).toEqual(['god', 'turbo']);
    expect(runCheatIds(save, 'versus')).toEqual([]);
    expect(cheatsBanner(save, 'solo', 'Cores')).toBe('CHEATS ON: GOD MODE, TURBO · no Cores, no records');
    expect(cheatsBanner(save, 'versus', 'Cores')).toMatch(/off in VERSUS/);
    expect(cheatsBanner(createTestSaveData(), 'solo', 'Cores')).toBe('');
  });

  it('pay no Cores and leave records and the leaderboard untouched', () => {
    const set = createFakeServices({ save: new FakeSaveStore(createTestSaveData()) });
    set.fsm.stack = ['GameOver'];
    const run = new FakeRunSession(testRunConfig({ runId: 'cheat-1', cheats: ['god'] }));
    run.world.run.wavesCleared = 6;
    run.world.players[0].score = 99_999;
    set.services.session.current = run;
    createGameOverState(set.services).enter({ outcome: 'defeat' }, 'Playing');
    expect(set.save.data.cores).toBe(0);
    expect(set.save.data.records.runs).toBe(0);
    expect(set.save.data.records.bestScore).toBe(0);
    expect(set.save.data.lastCommittedRunId).toBe('cheat-1');
    expect(set.ui.vm('gameOver')?.coresTotal).toBe(0);
    expect(set.ui.vm('gameOver')?.newBest).toBe(false);
    expect(set.ui.toasts.some((t) => /no Cores/.test(t.msg))).toBe(true);
  });
});
