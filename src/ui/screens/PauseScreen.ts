/**
 * Pause overlay: Resume / How to Play / Settings / Controls / Abandon (600 ms hold-to-confirm meter), the pause
 * reason, and next to the menu each player's INSTALLED powerups with descriptions.
 */
import type { PauseLoadoutVM, PauseVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { ClassSwitch, Flag, Shown, TextSlot, ViewPool, h } from '../dom';
import { playerTag } from '../format';
import { InstalledList } from '../widgets/InstalledList';
import { screenRoot } from '../view';
import { MenuList } from '../widgets/MenuList';
import { Meter } from '../widgets/Meter';
import { SubPanels } from './SubPanels';

const NO_CREDITS: readonly string[] = [];

class LoadoutColumn {
  readonly el: HTMLElement;
  private readonly tag: TextSlot;
  private readonly name: TextSlot;
  private readonly list: InstalledList;
  private readonly player: ClassSwitch;

  constructor(doc: Document) {
    const tagEl = h(doc, 'span', { className: 'kp-tag' });
    const nameEl = h(doc, 'span', { className: 'kp-pause-lo-name' });
    this.list = new InstalledList(doc, 'kp-pause-lo-list', 'Nothing yet: buy Systems or patch cards', 'rows');
    this.el = h(
      doc,
      'section',
      { className: 'kp-pause-lo' },
      h(doc, 'header', { className: 'kp-pause-lo-head' }, tagEl, nameEl),
      this.list.el,
    );
    this.tag = new TextSlot(tagEl);
    this.name = new TextSlot(nameEl);
    this.player = new ClassSwitch(this.el);
  }

  set(vm: PauseLoadoutVM): void {
    const tag = playerTag(vm.player);
    this.tag.set(tag);
    this.player.set('kp-' + tag.toLowerCase());
    this.name.set(vm.name);
    this.list.render(vm.items);
  }
}

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
  private readonly loadouts: ViewPool<LoadoutColumn>;
  private readonly loadoutShown: Shown;

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
    const loadoutCols = h(doc, 'div', { className: 'kp-pause-lo-cols' });
    const loadoutBox = h(
      doc,
      'div',
      { className: 'kp-panel kp-pause-installed' },
      h(doc, 'h2', { className: 'kp-panel-title', text: 'INSTALLED' }),
      loadoutCols,
    );
    this.el.appendChild(h(doc, 'div', { className: 'kp-pause-layout' }, menuBox, loadoutBox));
    this.el.appendChild(this.sub.el);
    this.loadouts = new ViewPool(loadoutCols, () => new LoadoutColumn(doc));
    this.loadoutShown = new Shown(loadoutBox, false);
    this.reason = new TextSlot(reasonEl);
    this.menuShown = new Shown(menuBox);
    this.holdShown = new Shown(holdEl, false);
    this.holding = new Flag(menuBox, 'is-holding');
  }

  render(vm: PauseVM): boolean {
    const panelOpen = this.sub.render(vm.panel, vm.settings, vm.controls, NO_CREDITS, vm.manual);
    this.menuShown.set(!panelOpen);
    let present = 0;
    for (const l of vm.loadouts) if (l.present) present++;
    this.loadoutShown.set(!panelOpen && present > 0);
    if (panelOpen) return false;
    this.loadouts.ensure(present);
    let k = 0;
    for (const l of vm.loadouts) if (l.present) this.loadouts.get(k++).set(l);
    this.reason.set(vm.reason);
    this.menu.render(vm.items, vm.cursor);
    const holding = vm.abandonHold > 0;
    this.holdShown.set(holding);
    this.holding.set(holding);
    this.hold.set(vm.abandonHold);
    return false;
  }
}
