/**
 * A vertical cursor list of MenuItemVMs. Shared menus use one cursor; per-player lists pass a second cursor
 * (P1 cyan marker, P2 magenta marker). Items are click targets (confirm + item id). The hint of the item under
 * the first cursor is shown in `hintEl`.
 */
import type { PlayerIndex } from '../../contracts/ids';
import type { MenuItemVM } from '../../contracts/ui';
import { AttrSlot, Flag, TextSlot, ViewPool, h, markClick } from '../dom';

class MenuItemView {
  readonly el: HTMLButtonElement;
  private readonly label: TextSlot;
  private readonly item: AttrSlot;
  private readonly disabledAttr: AttrSlot;
  private readonly cur0: Flag;
  private readonly cur1: Flag;
  private readonly disabled: Flag;

  constructor(doc: Document, player: PlayerIndex | 'any') {
    const text = h(doc, 'span', { className: 'kp-menu-label' });
    this.el = h(
      doc,
      'button',
      { className: 'kp-menu-item', attrs: { type: 'button', tabindex: '-1' } },
      h(doc, 'span', { className: 'kp-menu-caret', text: '>' }),
      text,
    );
    markClick(this.el, 'confirm', player, null);
    this.label = new TextSlot(text);
    this.item = new AttrSlot(this.el, 'data-item');
    this.disabledAttr = new AttrSlot(this.el, 'aria-disabled');
    this.cur0 = new Flag(this.el, 'is-cursor');
    this.cur1 = new Flag(this.el, 'is-cursor-p2');
    this.disabled = new Flag(this.el, 'is-disabled');
  }

  set(vm: MenuItemVM, cursor0: boolean, cursor1: boolean): void {
    this.label.set(vm.label);
    this.item.set(vm.id);
    this.disabledAttr.set(vm.enabled ? 'false' : 'true');
    this.disabled.set(!vm.enabled);
    this.cur0.set(cursor0);
    this.cur1.set(cursor1);
  }
}

export class MenuList {
  readonly el: HTMLDivElement;
  readonly hintEl: HTMLParagraphElement;
  private readonly pool: ViewPool<MenuItemView>;
  private readonly hint: TextSlot;

  constructor(doc: Document, className: string, player: PlayerIndex | 'any' = 'any') {
    this.el = h(doc, 'div', { className: className === '' ? 'kp-menu' : `kp-menu ${className}` });
    this.hintEl = h(doc, 'p', { className: 'kp-menu-hint' });
    this.hint = new TextSlot(this.hintEl);
    this.pool = new ViewPool(this.el, () => new MenuItemView(doc, player));
  }

  /** `cursor2` is the second player's cursor (-1 for none). */
  render(items: readonly MenuItemVM[], cursor: number, cursor2 = -1): void {
    this.pool.ensure(items.length);
    for (let i = 0; i < items.length; i++) this.pool.get(i).set(items[i]!, i === cursor, i === cursor2);
    const cur = items[cursor];
    this.hint.set(cur === undefined ? '' : cur.hint);
  }
}
