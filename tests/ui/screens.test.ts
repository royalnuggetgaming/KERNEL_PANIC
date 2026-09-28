import { describe, expect, it } from 'vitest';
import type { ControlsPanelVM, SettingsPanelVM } from '../../src/contracts/ui';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { CharacterSelectScreen } from '../../src/ui/screens/CharacterSelectScreen';
import { GameOverScreen, matchResultText } from '../../src/ui/screens/GameOverScreen';
import { MainMenuScreen } from '../../src/ui/screens/MainMenuScreen';
import { PauseScreen } from '../../src/ui/screens/PauseScreen';
import type { UiContext } from '../../src/ui/view';
import { FakeDocument, asDocument, asFake } from './fakeDom';
import { gameOverVM, goPlayer, mainMenuVM, pauseVM, selectVM, slotVM } from './fixtures';

const ctx = (): UiContext => ({ doc: asDocument(new FakeDocument()), theme: KERNEL_PANIC });

const SETTINGS: SettingsPanelVM = {
  rows: [
    { id: 'master', label: 'MASTER', kind: 'slider', value: '80%', fraction: 0.8 },
    { id: 'colorblind', label: 'COLOURBLIND', kind: 'toggle', value: 'ON', fraction: 0 },
    { id: 'quality', label: 'QUALITY', kind: 'choice', value: 'HIGH', fraction: 0 },
  ],
  cursor: 1,
  note: 'Theme applies on reload',
};

const CONTROLS: ControlsPanelVM = {
  players: [
    [
      { action: 'up', label: 'UP', keys: [{ code: 'KeyW', label: 'W', held: false }] },
      {
        action: 'fire',
        label: 'FIRE',
        keys: [
          { code: 'Space', label: 'SPACE', held: true },
          { code: 'KeyF', label: 'F', held: false },
        ],
      },
    ],
    [{ action: 'up', label: 'UP', keys: [{ code: 'ArrowUp', label: '↑', held: false }] }],
  ],
  cursor: { player: 1, row: 0 },
  capturing: { player: 0, action: 'fire' },
  swapOffer: 'F is bound to P1 SPECIAL. Swap?',
  keyTest: {
    active: true,
    held: [{ code: 'KeyW', label: 'W', held: true }],
    maxSimultaneous: 6,
    prompt: 'Hold W+D+SPACE and ↑+→+.',
  },
  message: '',
};

describe('ui/CharacterSelectScreen', () => {
  it('solo: P2 slot shows the join hint, no mode row', () => {
    const s = new CharacterSelectScreen(ctx());
    const el = asFake(s.el);
    s.render(selectVM());
    const [s1, s2] = el.byClass('kp-slot');
    expect(s1!.first('kp-join').hidden).toBe(true);
    expect(s1!.first('kp-veh-name').textContent).toBe('LANCER');
    expect(s1!.classList.contains('veh-lancer')).toBe(true);
    expect(s1!.byClass('kp-stat').length).toBe(2);
    expect(s1!.first('kp-veh-row').classList.contains('is-cursor')).toBe(true);
    expect(s2!.first('kp-join').hidden).toBe(false);
    expect(s2!.first('kp-join').getAttribute('data-item')).toBe('join');
    expect(s2!.first('kp-join').getAttribute('data-player')).toBe('1');
    expect(s2!.first('kp-join-hint').textContent).toBe('PRESS FIRE TO JOIN');
    expect(s2!.first('kp-slot-body').hidden).toBe(true);
    expect(el.first('kp-mode-row').hidden).toBe(true);
    expect(el.first('kp-cores-num').textContent).toBe('90');
  });

  it('two players: MODE row with per-player cursors, lock price, ready, countdown', () => {
    const s = new CharacterSelectScreen(ctx());
    const el = asFake(s.el);
    s.render(
      selectVM({
        slots: [
          slotVM(0, { cursorRow: 'mode', ready: true }),
          slotVM(1, { vehicle: 'specter', vehicleName: 'SPECTER', locked: true, unlockPrice: 60 }),
        ],
        mode: 'versus',
        modeRowVisible: true,
        modeLabel: 'VERSUS',
        countdown: 0.45,
      }),
    );
    const mode = el.first('kp-mode-row');
    expect(mode.hidden).toBe(false);
    expect(mode.first('kp-mode-label').textContent).toBe('VERSUS');
    expect(mode.classList.contains('mode-versus')).toBe(true);
    expect(mode.classList.contains('cur-p1')).toBe(true);
    expect(mode.classList.contains('cur-p2')).toBe(false);
    const [s1, s2] = el.byClass('kp-slot');
    expect(s1!.classList.contains('is-ready')).toBe(true);
    expect(s1!.first('kp-veh-row').classList.contains('is-cursor')).toBe(false);
    expect(s2!.classList.contains('is-locked')).toBe(true);
    expect(s2!.first('kp-veh-lock-text').textContent).toBe('LOCKED · UNLOCK FOR 60 Cores');
    expect(el.first('kp-select-countdown').textContent).toBe('LAUNCHING 0.5');
    s.render(
      selectVM({ slots: [slotVM(0), slotVM(1)], mode: 'coop', modeRowVisible: true, modeLabel: 'CO-OP' }),
    );
    expect(mode.classList.contains('mode-coop')).toBe(true);
    expect(el.first('kp-select-countdown').hidden).toBe(true);
    expect(el.first('kp-select-diff-value').textContent).toBe('NORMAL');
    s.render(selectVM({ difficulty: 'HARD' }));
    expect(el.first('kp-select-diff-value').textContent).toBe('HARD');
    expect(el.first('kp-select-diff-value').classList.contains('diff-hard')).toBe(true);
  });
});

describe('ui/GameOverScreen', () => {
  it('co-op: MVP badge, revives column, cores breakdown and new best', () => {
    const s = new GameOverScreen(ctx());
    const el = asFake(s.el);
    s.render(gameOverVM());
    expect(el.classList.contains('outcome-defeat')).toBe(true);
    expect(el.first('kp-go-match').hidden).toBe(true);
    const rows = el.byClass('kp-go-row');
    expect(rows[0]!.first('kp-badge').textContent).toBe('MVP');
    expect(rows[0]!.classList.contains('is-highlight')).toBe(true);
    expect(rows[1]!.first('kp-badge').textContent).toBe('');
    expect(el.findAll((e) => e.tagName === 'TH').map((e) => e.textContent)).toContain('REVIVES');
    expect(el.findAll((e) => e.tagName === 'TH').map((e) => e.textContent)).toContain('BITS');
    expect(el.first('kp-go-wave').textContent).toContain('CYCLE 7');
    expect(el.byClass('kp-cores-line').map((l) => l.textContent)).toEqual([
      'Bits earned+90',
      'Cycles cleared+18',
    ]);
    expect(el.first('kp-cores-total-num').textContent).toBe('108');
    expect(el.first('kp-new-best').hidden).toBe(false);
    expect(el.first('kp-cores-cap').hidden).toBe(true);
    expect(el.byClass('kp-menu-item').length).toBe(2);
  });

  it('versus: match winner line, WINNER badge and round wins column', () => {
    const s = new GameOverScreen(ctx());
    const el = asFake(s.el);
    const vm = gameOverVM({
      outcome: 'victory',
      mode: 'versus',
      winner: 1,
      players: [
        goPlayer(0, { roundWins: 1, mvp: false }),
        goPlayer(1, { name: 'TINKER', roundWins: 3, winner: true, mvp: false }),
      ],
      coresCapped: true,
    });
    s.render(vm);
    const match = el.first('kp-go-match');
    expect(match.hidden).toBe(false);
    expect(match.textContent).toBe('TINKER WINS THE MATCH');
    expect(match.classList.contains('kp-p2')).toBe(true);
    const rows = el.byClass('kp-go-row');
    expect(rows[1]!.first('kp-badge').textContent).toBe('WINNER');
    expect(el.findAll((e) => e.tagName === 'TH').map((e) => e.textContent)).toContain('ROUNDS');
    expect(el.first('kp-go-wave').hidden).toBe(true);
    expect(el.first('kp-cores-cap').hidden).toBe(false);
  });

  it('the player cell shows the tag and the craft, never the tag twice (critic v2 B6)', () => {
    const s = new GameOverScreen(ctx());
    const el = asFake(s.el);
    s.render(gameOverVM({ players: [goPlayer(0, { name: 'P1' }), goPlayer(1, { name: 'P2' })] }));
    const rows = el.byClass('kp-go-row');
    expect(rows[0]!.first('kp-tag').textContent).toBe('P1');
    expect(rows[0]!.first('kp-go-name').textContent).toBe('LANCER');
    expect(rows[1]!.first('kp-go-name').textContent).toBe('TINKER');
    expect(el.findAll((e) => e.tagName === 'TH').map((e) => e.textContent)).not.toContain('DAEMON');
  });

  it('matchResultText covers draw, abandon and non-versus', () => {
    expect(matchResultText(gameOverVM())).toBe('');
    expect(matchResultText(gameOverVM({ mode: 'versus', outcome: 'victory', winner: null }))).toBe(
      'MATCH DRAWN',
    );
    expect(matchResultText(gameOverVM({ mode: 'versus', outcome: 'abandoned' }))).toBe('MATCH ABANDONED');
    expect(
      matchResultText(
        gameOverVM({ mode: 'versus', outcome: 'victory', winner: 0, players: [goPlayer(0, { name: '' })] }),
      ),
    ).toBe('P1 WINS THE MATCH');
  });
});

describe('ui/MainMenu and Pause sub-panels', () => {
  it('settings panel replaces the menu list', () => {
    const s = new MainMenuScreen(ctx());
    const el = asFake(s.el);
    el.hidden = false;
    s.render(mainMenuVM({ panel: 'settings', settings: SETTINGS }));
    expect(el.first('kp-menu-box').hidden).toBe(true);
    expect(el.first('kp-settings').hidden).toBe(false);
    expect(el.first('kp-controls').hidden).toBe(true);
    const rows = el.byClass('kp-set-row').filter((r) => r.visible);
    expect(rows.length).toBe(3);
    expect(rows[0]!.first('kp-set-slider').hidden).toBe(false);
    expect(rows[0]!.byClass('kp-arrow')[0]!.getAttribute('data-kind')).toBe('left');
    expect(rows[0]!.byClass('kp-arrow')[1]!.getAttribute('data-item')).toBe('master');
    expect(rows[0]!.first('kp-set-meter').children[0]!.style.transform).toBe('scaleX(0.800)');
    expect(rows[1]!.classList.contains('is-cursor')).toBe(true);
    expect(rows[1]!.classList.contains('is-on')).toBe(true);
    expect(rows[1]!.first('kp-set-slider').hidden).toBe(true);
    expect(rows[2]!.first('kp-set-value').getAttribute('data-item')).toBe('quality');
    expect(el.first('kp-set-note').textContent).toBe('Theme applies on reload');
    s.render(mainMenuVM({ panel: 'credits' }));
    expect(el.first('kp-credits').hidden).toBe(false);
    expect(el.first('kp-credit').textContent).toBe('Made with three.js');
    s.render(mainMenuVM());
    expect(el.first('kp-menu-box').hidden).toBe(false);
    expect(el.first('kp-credits').hidden).toBe(true);
  });

  it('controls panel: per-player cursor, capture prompt, swap offer, key test', () => {
    const s = new PauseScreen(ctx());
    const el = asFake(s.el);
    s.render(pauseVM({ panel: 'controls', controls: CONTROLS }));
    expect(el.first('kp-pause-box').hidden).toBe(true);
    const [c1, c2] = el.byClass('kp-ctl-col');
    const p1rows = c1!.byClass('kp-ctl-row');
    expect(p1rows[1]!.classList.contains('is-capturing')).toBe(true);
    expect(p1rows[1]!.first('kp-ctl-prompt').hidden).toBe(false);
    expect(p1rows[1]!.first('kp-ctl-caps').hidden).toBe(true);
    expect(p1rows[1]!.getAttribute('data-item')).toBe('fire');
    expect(p1rows[1]!.getAttribute('data-player')).toBe('0');
    expect(p1rows[0]!.byClass('kp-keycap')[0]!.textContent).toBe('W');
    expect(c2!.byClass('kp-ctl-row')[0]!.classList.contains('is-cursor')).toBe(true);
    expect(el.first('kp-ctl-swap').hidden).toBe(false);
    expect(el.first('kp-keytest').hidden).toBe(false);
    expect(el.first('kp-kt-max-num').textContent).toBe('6');
    expect(el.first('kp-kt-held').byClass('kp-keycap')[0]!.classList.contains('is-held')).toBe(true);
  });

  it('pause shows the abandon hold meter only while holding', () => {
    const s = new PauseScreen(ctx());
    const el = asFake(s.el);
    s.render(pauseVM());
    expect(el.first('kp-hold').hidden).toBe(true);
    expect(el.first('kp-pause-reason').textContent).toBe('Paused');
    s.render(pauseVM({ cursor: 1, abandonHold: 0.5 }));
    expect(el.first('kp-hold').hidden).toBe(false);
    expect(el.first('kp-hold-meter').children[0]!.style.transform).toBe('scaleX(0.500)');
    expect(el.first('kp-menu-hint').textContent).toBe('Hold to abandon');
  });
});
