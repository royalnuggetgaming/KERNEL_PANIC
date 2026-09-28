/**
 * A player's installed powerups (InstalledItemVM list). Three looks:
 * - 'names' (Patch Bay INSTALLED): wrapped chips "Thrusters 2", tooltip = description;
 * - 'chips' (HUD strip): compact chips "THR 2", tooltip = name + description;
 * - 'rows' (Pause): one line per item, name + count and the description.
 * Rendering is diffed: the DOM is touched only when the list identity changes.
 */
import type { InstalledItemVM } from '../../contracts/ui';
import { AttrSlot, ClassSwitch, Shown, TextSlot, ViewPool, h } from '../dom';

export type InstalledLook = 'names' | 'chips' | 'rows';

const KIND_CLASS: Readonly<Record<InstalledItemVM['kind'], string>> = {
  stat: 'inst-stat',
  card: 'inst-card',
  team: 'inst-team',
};

class InstalledItemView {
  readonly el: HTMLElement;
  private readonly name: TextSlot;
  private readonly count: TextSlot;
  private readonly desc: TextSlot | null;
  private readonly title: AttrSlot;
  private readonly kind: ClassSwitch;
  private readonly look: InstalledLook;

  constructor(doc: Document, look: InstalledLook) {
    this.look = look;
    const nameEl = h(doc, 'span', { className: 'kp-inst-name' });
    const countEl = h(doc, 'span', { className: 'kp-inst-count' });
    if (look === 'rows') {
      const descEl = h(doc, 'span', { className: 'kp-inst-desc' });
      this.el = h(doc, 'li', { className: 'kp-inst kp-inst-row' }, nameEl, countEl, descEl);
      this.desc = new TextSlot(descEl);
    } else {
      this.el = h(doc, 'span', { className: `kp-inst kp-inst-${look}` }, nameEl, countEl);
      this.desc = null;
    }
    this.name = new TextSlot(nameEl);
    this.count = new TextSlot(countEl);
    this.title = new AttrSlot(this.el, 'title');
    this.kind = new ClassSwitch(this.el);
  }

  set(vm: InstalledItemVM): void {
    this.name.set(this.look === 'chips' ? vm.short : vm.label);
    this.count.set(vm.count);
    this.kind.set(KIND_CLASS[vm.kind]);
    if (this.desc !== null) this.desc.set(vm.desc);
    this.title.set(this.look === 'chips' ? `${vm.label} ${vm.count}: ${vm.desc}` : vm.desc);
  }
}

export class InstalledList {
  readonly el: HTMLElement;
  private readonly pool: ViewPool<InstalledItemView>;
  private readonly empty: Shown;
  private last: readonly InstalledItemVM[] | null = null;

  constructor(doc: Document, className: string, emptyText: string, look: InstalledLook = 'names') {
    const list = h(doc, look === 'rows' ? 'ul' : 'div', { className: 'kp-inst-list' });
    const emptyEl = h(doc, 'span', { className: 'kp-inst-empty', text: emptyText });
    this.el = h(doc, 'div', { className: `kp-installed kp-installed-${look} ${className}` }, list, emptyEl);
    this.pool = new ViewPool(list, () => new InstalledItemView(doc, look));
    this.empty = new Shown(emptyEl, true);
  }

  /** Re-renders only when the list identity changes (VM builders reuse the array while nothing changed). */
  render(items: readonly InstalledItemVM[]): void {
    if (items === this.last) return;
    this.last = items;
    this.pool.ensure(items.length);
    for (let i = 0; i < items.length; i++) this.pool.get(i).set(items[i]!);
    this.empty.set(items.length === 0);
  }
}
