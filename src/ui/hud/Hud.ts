/**
 * HUD root (`contain: strict`). Bars and state flags update on every render via transforms/classes; numeric text
 * (timer, HP, wallets, scores, combo, fps) at most every HUD_TEXT_INTERVAL_MS and only on change. Nothing here
 * reads layout. Versus shows the round counter and the round-win score instead of Spare Kernels.
 */
import type { HudVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { Flag, NumSlot, Shown, TextSlot, h } from '../dom';
import { formatShards } from '../format';
import { screenRoot } from '../view';
import { BossBar } from './BossBar';
import { PlayerPanel } from './PlayerPanel';
import { WaveBanner } from './WaveBanner';

/** 10 Hz text throttle. */
export const HUD_TEXT_INTERVAL_MS = 100;
/** Round-win pips per player (first to 3, docs/ARCHITECTURE.md versus addendum); grows if a VM exceeds it. */
const VERSUS_PIPS = 3;

export class Hud implements ScreenView<'hud'> {
  readonly id = 'hud' as const;
  readonly el: HTMLElement;
  private readonly p1: PlayerPanel;
  private readonly p2: PlayerPanel;
  private readonly boss: BossBar;
  private readonly banner: WaveBanner;
  private readonly waveLabel: TextSlot;
  private readonly timer: TextSlot;
  private readonly kernels: NumSlot;
  private readonly livesLabel: TextSlot;
  private readonly livesShown: Shown;
  private readonly versusShown: Shown;
  private readonly score0: NumSlot;
  private readonly score1: NumSlot;
  private readonly suddenDeath: Flag;
  private readonly fps: TextSlot;
  private readonly fpsShown: Shown;
  private readonly modeVersus: Flag;
  private lastTextAt = Number.NEGATIVE_INFINITY;
  private textVm: HudVM | null = null;

  constructor(ctx: UiContext) {
    const doc = ctx.doc;
    this.el = screenRoot(ctx, 'hud', 'kp-hud');
    this.p1 = new PlayerPanel(ctx, 0);
    this.p2 = new PlayerPanel(ctx, 1);
    this.boss = new BossBar(doc);
    this.banner = new WaveBanner(doc);

    const waveEl = h(doc, 'div', { className: 'kp-hud-wave' });
    const timerEl = h(doc, 'div', { className: 'kp-hud-timer' });
    const kernelsNum = h(doc, 'span', { className: 'kp-hud-kernels-num' });
    const livesLabelEl = h(doc, 'span', { className: 'kp-hud-kernels-label' });
    const livesEl = h(doc, 'div', { className: 'kp-hud-kernels' }, livesLabelEl, kernelsNum);
    const s0 = h(doc, 'span', { className: 'kp-vs-score kp-p1' });
    const s1 = h(doc, 'span', { className: 'kp-vs-score kp-p2' });
    const suddenEl = h(doc, 'div', { className: 'kp-vs-sudden', text: 'SUDDEN DEATH' });
    const versusEl = h(
      doc,
      'div',
      { className: 'kp-hud-versus' },
      h(
        doc,
        'div',
        { className: 'kp-vs-line' },
        s0,
        h(doc, 'span', { className: 'kp-vs-sep', text: ':' }),
        s1,
      ),
      suddenEl,
    );
    const fpsEl = h(doc, 'div', { className: 'kp-hud-fps' });

    const top = h(doc, 'div', { className: 'kp-hud-top' }, waveEl, timerEl, livesEl, versusEl);
    const bottom = h(doc, 'div', { className: 'kp-hud-bottom' }, this.p1.el, this.p2.el);
    this.el.appendChild(top);
    this.el.appendChild(this.boss.el);
    this.el.appendChild(this.banner.el);
    this.el.appendChild(bottom);
    this.el.appendChild(fpsEl);

    this.waveLabel = new TextSlot(waveEl);
    this.timer = new TextSlot(timerEl);
    this.kernels = new NumSlot(kernelsNum, formatKernels);
    this.livesLabel = new TextSlot(livesLabelEl);
    this.livesShown = new Shown(livesEl);
    this.versusShown = new Shown(versusEl, false);
    this.score0 = new NumSlot(s0, formatShards);
    this.score1 = new NumSlot(s1, formatShards);
    this.suddenDeath = new Flag(this.el, 'is-sudden-death');
    this.fps = new TextSlot(fpsEl);
    this.fpsShown = new Shown(fpsEl, false);
    this.modeVersus = new Flag(this.el, 'is-versus');
  }

  render(vm: HudVM, nowMs: number): boolean {
    const versus = vm.versus.visible;
    const textDue = nowMs - this.lastTextAt >= HUD_TEXT_INTERVAL_MS;
    const text = textDue && vm !== this.textVm;
    if (text) {
      this.lastTextAt = nowMs;
      this.textVm = vm;
    }

    this.modeVersus.set(versus);
    this.p1.render(vm.players[0], text, versus, VERSUS_PIPS);
    this.p2.render(vm.players[1], text, versus, VERSUS_PIPS);
    this.boss.render(vm.boss);
    this.banner.render(vm.banner);
    this.waveLabel.set(vm.waveLabel);
    this.livesShown.set(!versus);
    this.versusShown.set(versus);
    this.suddenDeath.set(versus && vm.versus.suddenDeath);
    this.fpsShown.set(vm.fps !== null);
    if (versus) {
      this.score0.set(vm.versus.roundWins[0]);
      this.score1.set(vm.versus.roundWins[1]);
    }
    if (text) {
      this.timer.set(vm.timer);
      if (!versus) {
        this.livesLabel.set(vm.livesLabel);
        this.kernels.set(vm.kernels);
      }
      if (vm.fps !== null) this.fps.set(vm.fps);
    }
    // A VM whose text was withheld by the throttle needs one more render once the interval has passed.
    return vm !== this.textVm;
  }
}

function formatKernels(n: number): string {
  return ' ×' + String(Math.max(0, Math.floor(n)));
}
