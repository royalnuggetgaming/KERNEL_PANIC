import { describe, expect, it } from 'vitest';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { HUD_TEXT_INTERVAL_MS, Hud } from '../../src/ui/hud/Hud';
import { createUiRootWithClock } from '../../src/ui/UIRoot';
import { FakeDocument, asDocument, asElement, asFake, type FakeElement } from './fakeDom';
import { hudPlayerVM, hudVM } from './fixtures';

function makeHud() {
  const hud = new Hud({ doc: asDocument(new FakeDocument()), theme: KERNEL_PANIC });
  return { hud, el: asFake(hud.el) };
}

function panels(el: FakeElement): FakeElement[] {
  return el.byClass('kp-pp');
}

describe('ui/hud', () => {
  it('uses contain: strict root class and renders both panels', () => {
    const { hud, el } = makeHud();
    expect(el.classList.contains('kp-hud')).toBe(true);
    hud.render(hudVM(), 0);
    const [p1, p2] = panels(el);
    expect(p1!.hidden).toBe(false);
    expect(p1!.classList.contains('kp-p1')).toBe(true);
    expect(p2!.classList.contains('kp-p2')).toBe(true);
    expect(p1!.first('kp-pp-hp-text').textContent).toBe('80/100');
    expect(p1!.first('kp-pp-wallet-num').textContent).toBe('1,500');
    expect(p1!.first('kp-pp-score').textContent).toBe('12,000');
    expect(p1!.first('kp-pp-combo-text').textContent).toBe('x12');
    expect(p1!.first('kp-pp-combo').classList.contains('tier-1')).toBe(true);
    expect(el.first('kp-hud-timer').textContent).toBe('0:41');
    expect(el.first('kp-hud-wave').textContent).toBe('SECTOR 1 / CYCLE 2');
    expect(el.first('kp-hud-kernels-num').textContent).toBe(' ×2');
    expect(el.first('kp-hud-kernels').hidden).toBe(false);
    expect(el.first('kp-hud-versus').hidden).toBe(true);
  });

  it('throttles text to 10 Hz but moves bars every render', () => {
    const { hud, el } = makeHud();
    hud.render(hudVM(), 0);
    const hpFill = panels(el)[0]!.first('kp-pp-hp').children[0]!;
    const vm2 = hudVM({
      timer: '0:40',
      players: [hudPlayerVM({ hp: 50, hpFrac: 0.5 }), hudPlayerVM()],
    });
    const again = hud.render(vm2, HUD_TEXT_INTERVAL_MS / 2);
    expect(again).toBe(true);
    expect(el.first('kp-hud-timer').textContent).toBe('0:41');
    expect(hpFill.style.transform).toBe('scaleX(0.500)');
    expect(panels(el)[0]!.first('kp-pp-hp-text').textContent).toBe('80/100');
    const done = hud.render(vm2, HUD_TEXT_INTERVAL_MS + 1);
    expect(done).toBe(false);
    expect(el.first('kp-hud-timer').textContent).toBe('0:40');
    expect(panels(el)[0]!.first('kp-pp-hp-text').textContent).toBe('50/100');
  });

  it('writes text only on change', () => {
    const { hud, el } = makeHud();
    hud.render(hudVM(), 0);
    const timer = el.first('kp-hud-timer');
    const writes = timer.textWrites;
    hud.render(hudVM(), 200);
    hud.render(hudVM(), 400);
    expect(timer.textWrites).toBe(writes);
  });

  it('versus: round score, win pips, sudden death, no kernels', () => {
    const { hud, el } = makeHud();
    hud.render(
      hudVM({
        mode: 'versus',
        waveLabel: 'ROUND 3',
        players: [hudPlayerVM({ roundWins: 2 }), hudPlayerVM({ roundWins: 1 })],
        versus: { visible: true, round: 3, roundWins: [2, 1], suddenDeath: true },
      }),
      0,
    );
    expect(el.classList.contains('is-versus')).toBe(true);
    expect(el.first('kp-hud-kernels').hidden).toBe(true);
    expect(el.first('kp-hud-versus').hidden).toBe(false);
    expect(el.first('kp-hud-wave').textContent).toBe('ROUND 3');
    const scores = el.byClass('kp-vs-score').map((s) => s.textContent);
    expect(scores).toEqual(['2', '1']);
    expect(el.classList.contains('is-sudden-death')).toBe(true);
    const pips = panels(el)[0]!
      .byClass('kp-win-pip')
      .filter((p) => !p.hidden);
    expect(pips.length).toBe(3);
    expect(pips.filter((p) => p.classList.contains('is-full')).length).toBe(2);
  });

  it('co-op states: downed bleed-out, revive bar, absent partner, dash pips, overdrive ready', () => {
    const { hud, el } = makeHud();
    hud.render(
      hudVM({
        players: [
          hudPlayerVM({ life: 'downed', bleedFrac: 0.4, reviveFrac: 0.3, overdriveFrac: 1, combo: 0 }),
          hudPlayerVM({ present: false, life: 'absent' }),
        ],
      }),
      0,
    );
    const [p1, p2] = panels(el);
    expect(p2!.hidden).toBe(true);
    expect(p1!.classList.contains('life-downed')).toBe(true);
    expect(p1!.first('kp-pp-life').textContent).toBe('DOWNED');
    expect(p1!.first('kp-pp-bleed-box').hidden).toBe(false);
    expect(p1!.first('kp-pp-revive-box').hidden).toBe(false);
    expect(p1!.first('kp-pp-combo').hidden).toBe(true);
    expect(p1!.classList.contains('is-od-ready')).toBe(true);
    const dash = p1!.byClass('kp-dash-pip').map((d) => d.children[0]!.style.transform);
    expect(dash).toEqual(['scaleX(1.000)', 'scaleX(0.500)']);
  });

  it('boss bar, banner and fps', () => {
    const { hud, el } = makeHud();
    hud.render(
      hudVM({
        boss: { visible: true, name: 'FORK BOMB', hpFrac: 0.75 },
        banner: { visible: true, text: 'CYCLE 5', sub: 'BOSS' },
        fps: '120 FPS',
      }),
      0,
    );
    expect(el.first('kp-boss').classList.contains('is-on')).toBe(true);
    expect(el.first('kp-boss-name').textContent).toBe('FORK BOMB');
    expect(el.first('kp-banner').classList.contains('is-on')).toBe(true);
    expect(el.first('kp-banner-text').textContent).toBe('CYCLE 5');
    expect(el.first('kp-hud-fps').hidden).toBe(false);
    expect(el.first('kp-hud-fps').textContent).toBe('120 FPS');
    hud.render(hudVM(), 500);
    expect(el.first('kp-boss').classList.contains('is-on')).toBe(false);
    expect(el.first('kp-banner').classList.contains('is-on')).toBe(false);
    expect(el.first('kp-banner-text').textContent).toBe('CYCLE 5');
    expect(el.first('kp-hud-fps').hidden).toBe(true);
  });

  it('UIRoot re-renders a throttled HUD on a later flush without a new VM', () => {
    const fdoc = new FakeDocument();
    const root = fdoc.createElement('div');
    let t = 0;
    const ui = createUiRootWithClock(
      { root: asElement(root), theme: KERNEL_PANIC, doc: asDocument(fdoc) },
      () => t,
    );
    const hudEl = root.byAttr('data-screen', 'hud')[0]!;
    ui.show('hud', hudVM());
    ui.flush();
    t = 30;
    ui.update('hud', hudVM({ timer: '0:39' }));
    ui.flush();
    expect(hudEl.first('kp-hud-timer').textContent).toBe('0:41');
    t = 150;
    ui.flush();
    expect(hudEl.first('kp-hud-timer').textContent).toBe('0:39');
  });
});
