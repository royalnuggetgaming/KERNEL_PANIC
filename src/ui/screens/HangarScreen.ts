/**
 * Firmware hangar (UpgradesShop{meta}): one shared list of firmware upgrades, vehicle unlocks and Respec with
 * a single cursor (every row shows its description and current -> next level), the Cores balance, the respec refund preview and a read-only notice (another tab owns the
 * save).
 */
import type { HangarVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { Flag, NumSlot, Shown, TextSlot, ViewPool, button, h } from '../dom';
import { formatShards } from '../format';
import { screenRoot } from '../view';
import { ShopRowView } from '../widgets/ShopRow';

export class HangarScreen implements ScreenView<'hangar'> {
  readonly id = 'hangar' as const;
  readonly el: HTMLElement;
  private readonly title: TextSlot;
  private readonly cores: NumSlot;
  private readonly currency: TextSlot;
  private readonly items: ViewPool<ShopRowView>;
  private lastCursor = -1;
  private readonly refund: TextSlot;
  private readonly refundShown: Shown;
  private readonly message: TextSlot;
  private readonly readOnlyShown: Shown;
  private readonly readOnly: Flag;

  constructor(ctx: UiContext) {
    const doc = ctx.doc;
    this.el = screenRoot(ctx, 'hangar', 'kp-hangar');
    const titleEl = h(doc, 'h2', { className: 'kp-panel-title' });
    const coresEl = h(doc, 'span', { className: 'kp-cores-num' });
    const currencyEl = h(doc, 'span', { className: 'kp-unit' });
    const list = h(doc, 'div', { className: 'kp-hangar-list' });
    const refundEl = h(doc, 'p', { className: 'kp-hangar-refund kp-dim' });
    const msgEl = h(doc, 'p', { className: 'kp-hangar-msg kp-warn' });
    const readOnlyEl = h(doc, 'p', {
      className: 'kp-hangar-ro kp-warn',
      text: 'READ-ONLY: the save is open in another tab.',
    });
    this.el.appendChild(
      h(
        doc,
        'div',
        { className: 'kp-panel kp-hangar-box' },
        h(
          doc,
          'header',
          { className: 'kp-hangar-head' },
          titleEl,
          h(doc, 'span', { className: 'kp-cores' }, coresEl, currencyEl),
        ),
        readOnlyEl,
        list,
        refundEl,
        msgEl,
        h(
          doc,
          'div',
          { className: 'kp-btn-row' },
          button(doc, 'kp-btn kp-back', 'BACK', 'back', 'any', 'back'),
        ),
      ),
    );
    this.title = new TextSlot(titleEl);
    this.cores = new NumSlot(coresEl, formatShards);
    this.currency = new TextSlot(currencyEl);
    this.items = new ViewPool(list, () => new ShopRowView(doc, 'plain', 'any'));
    this.refund = new TextSlot(refundEl);
    this.refundShown = new Shown(refundEl, false);
    this.message = new TextSlot(msgEl);
    this.readOnlyShown = new Shown(readOnlyEl, false);
    this.readOnly = new Flag(this.el, 'is-readonly');
  }

  onShow(): void {
    this.lastCursor = -1;
  }

  render(vm: HangarVM): boolean {
    this.title.set(vm.title);
    this.cores.set(vm.cores);
    this.currency.set(' ' + vm.metaCurrency);
    this.items.ensure(vm.items.length);
    for (let i = 0; i < vm.items.length; i++) this.items.get(i).set(vm.items[i]!, i === vm.cursor, 0);
    const cur = vm.items[vm.cursor];
    if (vm.cursor !== this.lastCursor && vm.cursor < this.items.count) {
      // Every row carries its own description line; keep the cursor row visible in the scrolling list.
      this.lastCursor = vm.cursor;
      const el = this.items.get(vm.cursor).el;
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
    const showRefund = cur?.kind === 'respec';
    this.refundShown.set(showRefund);
    if (showRefund) this.refund.set(`REFUND +${formatShards(vm.respecRefund)} ${vm.metaCurrency}`);
    this.message.set(vm.message);
    this.readOnlyShown.set(vm.readOnly);
    this.readOnly.set(vm.readOnly);
    return false;
  }
}
