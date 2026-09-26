/**
 * One shop line (stat row, repair, patch card, team item, reroll, gift, hangar item): label, level, price or
 * status tag, cursor highlight, and for cards a separate Lock column. Price colouring comes from the status
 * class (st-unaffordable is red, st-maxed/capped/soldOut dim).
 */
import type { PlayerIndex } from '../../contracts/ids';
import type { ShopItemStatus } from '../../contracts/run';
import type { ShopCardVM, ShopRowVM } from '../../contracts/ui';
import { AttrSlot, ClassSwitch, Flag, Shown, TextSlot, h, markClick } from '../dom';
import { formatLevel, formatPrice, shopStatusLabel } from '../format';
import { LOCK_PREFIX } from '../pointer';

export type ShopRowKind = 'stat' | 'card' | 'plain';

const STATUS_CLASS: Readonly<Record<ShopItemStatus, string>> = {
  available: 'st-available',
  unaffordable: 'st-unaffordable',
  maxed: 'st-maxed',
  capped: 'st-capped',
  soldOut: 'st-soldout',
  locked: 'st-locked',
  owned: 'st-owned',
  unavailable: 'st-unavailable',
  heldCap: 'st-heldcap',
};

const RARITY_CLASS: Readonly<Record<ShopCardVM['rarity'], string>> = {
  C: 'rar-c',
  U: 'rar-u',
  R: 'rar-r',
  L: 'rar-l',
};

const RARITY_NAME: Readonly<Record<ShopCardVM['rarity'], string>> = {
  C: 'COMMON',
  U: 'UNCOMMON',
  R: 'RARE',
  L: 'LEGENDARY',
};

export class ShopRowView {
  readonly el: HTMLDivElement;
  private readonly buyItem: AttrSlot;
  private readonly lockItem: AttrSlot | null;
  private readonly lockText: TextSlot | null;
  private readonly label: TextSlot;
  private readonly level: TextSlot;
  private readonly levelShown: Shown;
  private readonly price: TextSlot;
  private readonly status: ClassSwitch;
  private readonly rarity: ClassSwitch;
  private readonly cursor: Flag;
  private readonly lockCol: Flag;
  private readonly locked: Flag;
  private readonly kind: ShopRowKind;

  constructor(doc: Document, kind: ShopRowKind, player: PlayerIndex | 'any') {
    this.kind = kind;
    const labelEl = h(doc, 'span', { className: 'kp-row-label' });
    const levelEl = h(doc, 'span', { className: 'kp-row-level' });
    const priceEl = h(doc, 'span', { className: 'kp-row-price' });
    const buy = h(
      doc,
      'button',
      { className: 'kp-row-buy', attrs: { type: 'button', tabindex: '-1' } },
      h(doc, 'span', { className: 'kp-row-caret', text: '>' }),
      labelEl,
      levelEl,
      priceEl,
    );
    markClick(buy, 'confirm', player, null);
    this.el = h(doc, 'div', { className: `kp-row kp-row-${kind}` }, buy);
    this.buyItem = new AttrSlot(buy, 'data-item');
    if (kind === 'card') {
      const lock = h(doc, 'button', {
        className: 'kp-row-lock',
        text: 'LOCK',
        attrs: { type: 'button', tabindex: '-1' },
      });
      markClick(lock, 'confirm', player, null);
      this.el.appendChild(lock);
      this.lockText = new TextSlot(lock);
      this.lockItem = new AttrSlot(lock, 'data-item');
    } else {
      this.lockText = null;
      this.lockItem = null;
    }
    this.label = new TextSlot(labelEl);
    this.level = new TextSlot(levelEl);
    this.levelShown = new Shown(levelEl, kind !== 'plain');
    this.price = new TextSlot(priceEl);
    this.status = new ClassSwitch(this.el);
    this.rarity = new ClassSwitch(this.el);
    this.cursor = new Flag(this.el, 'is-cursor');
    this.lockCol = new Flag(this.el, 'is-col-lock');
    this.locked = new Flag(this.el, 'is-locked');
  }

  set(vm: ShopRowVM, cursor: boolean, col: 0 | 1): void {
    this.label.set(vm.label);
    this.buyItem.set(vm.id);
    const tag = shopStatusLabel(vm.status);
    this.price.set(tag === '' ? formatPrice(vm.price) : tag);
    this.status.set(STATUS_CLASS[vm.status]);
    this.cursor.set(cursor);
    if (this.kind === 'stat') {
      this.level.set(formatLevel(vm.level, vm.maxLevel));
    } else if (this.kind === 'plain') {
      const show = vm.maxLevel > 0;
      this.levelShown.set(show);
      if (show) this.level.set(formatLevel(vm.level, vm.maxLevel));
    }
    this.lockCol.set(cursor && col === 1 && this.kind === 'card');
  }

  setCard(vm: ShopCardVM, cursor: boolean, col: 0 | 1): void {
    this.set(vm, cursor, col);
    this.level.set(RARITY_NAME[vm.rarity]);
    this.rarity.set(RARITY_CLASS[vm.rarity]);
    this.locked.set(vm.locked);
    if (this.lockItem !== null) this.lockItem.set(LOCK_PREFIX + vm.id);
    if (this.lockText !== null) this.lockText.set(vm.locked ? 'LOCKED' : 'LOCK');
  }
}
