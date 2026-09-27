/** Pause overlay: Resume / Settings / Controls / Abandon (600 ms hold-to-confirm meter) and the pause reason. */
import type { PauseVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { Flag, Shown, TextSlot, h } from '../dom';
import { screenRoot } from '../view';
import { MenuList } from '../widgets/MenuList';
import { Meter } from '../widgets/Meter';
import { SubPanels } from './SubPanels';

const NO_CREDITS: readonly string[] = [];

export class PauseScreen implements ScreenView<'pause'> {
  readonly id = 'pause' as const;
  readonly el: HTMLElement;
  private readonly menu: MenuList;
  private readonly menuShown: Shown;
  private readonly sub: SubPanels;
  private readonly reason: TextSlot;
  private readonly hold: Meter;
  private readonly holdShown: Shown;
  private readonly holding: Flag;

  constructor(ctx: UiContext) {
    const doc = ctx.doc;
    this.el = screenRoot(ctx, 'pause', 'kp-overlay kp-center');
    const reasonEl = h(doc, 'p', { className: 'kp-pause-reason kp-dim' });
    this.menu = new MenuList(doc, 'kp-pause-menu');
    this.hold = new Meter(doc, 'kp-hold-meter');
    const holdEl = h(
      doc,
      'div',
      { className: 'kp-hold' },
      h(doc, 'span', { className: 'kp-danger', text: 'HOLD TO ABANDON' }),
      this.hold.el,
    );
    const menuBox = h(
      doc,
      'div',
      { className: 'kp-panel kp-pause-box' },
      h(doc, 'h2', { className: 'kp-panel-title', text: 'PAUSED' }),
      reasonEl,
      this.menu.el,
      holdEl,
      this.menu.hintEl,
    );
    this.sub = new SubPanels(doc);
    this.el.appendChild(menuBox);
    this.el.appendChild(this.sub.el);
    this.reason = new TextSlot(reasonEl);
    this.menuShown = new Shown(menuBox);
    this.holdShown = new Shown(holdEl, false);
    this.holding = new Flag(menuBox, 'is-holding');
  }

  render(vm: PauseVM): boolean {
    const panelOpen = this.sub.render(vm.panel, vm.settings, vm.controls, NO_CREDITS);
    this.menuShown.set(!panelOpen);
    if (panelOpen) return false;
    this.reason.set(vm.reason);
    this.menu.render(vm.items, vm.cursor);
    const holding = vm.abandonHold > 0;
    this.holdShown.set(holding);
    this.holding.set(holding);
    this.hold.set(vm.abandonHold);
    return false;
  }
}
