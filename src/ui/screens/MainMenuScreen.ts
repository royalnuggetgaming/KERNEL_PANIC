/** Main menu over the attract backdrop: title, tagline, menu list, Cores balance, version, sub-panels. */
import type { MainMenuVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { NumSlot, Shown, TextSlot, h } from '../dom';
import { formatShards } from '../format';
import { screenRoot } from '../view';
import { MenuList } from '../widgets/MenuList';
import { SubPanels } from './SubPanels';

export class MainMenuScreen implements ScreenView<'mainMenu'> {
  readonly id = 'mainMenu' as const;
  readonly el: HTMLElement;
  private readonly title: TextSlot;
  private readonly tagline: TextSlot;
  private readonly menu: MenuList;
  private readonly menuShown: Shown;
  private readonly sub: SubPanels;
  private readonly cores: NumSlot;
  private readonly currency: TextSlot;
  private readonly version: TextSlot;

  constructor(ctx: UiContext) {
    const doc = ctx.doc;
    this.el = screenRoot(ctx, 'mainMenu', 'kp-menu-screen');
    const titleEl = h(doc, 'h1', { className: 'kp-title kp-glitch' });
    const taglineEl = h(doc, 'p', { className: 'kp-tagline' });
    this.menu = new MenuList(doc, 'kp-main-menu');
    const menuBox = h(doc, 'nav', { className: 'kp-menu-box' }, this.menu.el, this.menu.hintEl);
    this.sub = new SubPanels(doc);
    const coresEl = h(doc, 'span', { className: 'kp-cores-num' });
    const currencyEl = h(doc, 'span', { className: 'kp-unit' });
    const versionEl = h(doc, 'span', { className: 'kp-version kp-dim' });
    this.el.appendChild(
      h(
        doc,
        'div',
        { className: 'kp-main' },
        h(doc, 'header', { className: 'kp-main-head' }, titleEl, taglineEl),
        menuBox,
        this.sub.el,
        h(
          doc,
          'footer',
          { className: 'kp-main-foot' },
          h(doc, 'span', { className: 'kp-cores' }, coresEl, currencyEl),
          versionEl,
        ),
      ),
    );
    this.title = new TextSlot(titleEl);
    this.tagline = new TextSlot(taglineEl);
    this.menuShown = new Shown(menuBox);
    this.cores = new NumSlot(coresEl, formatShards);
    this.currency = new TextSlot(currencyEl);
    this.version = new TextSlot(versionEl);
  }

  render(vm: MainMenuVM): boolean {
    this.title.set(vm.title);
    this.tagline.set(vm.tagline);
    const panelOpen = this.sub.render(vm.panel, vm.settings, vm.controls, vm.credits);
    this.menuShown.set(!panelOpen);
    if (!panelOpen) this.menu.render(vm.items, vm.cursor);
    this.cores.set(vm.cores);
    this.currency.set(' ' + vm.metaCurrency);
    this.version.set(vm.version);
    return false;
  }
}
