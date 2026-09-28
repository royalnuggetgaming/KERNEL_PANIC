/**
 * One player's Patch Bay column: header (wallet, HP); a scrolling list of stat rows, repair, patch cards with
 * Buy/Lock columns, the team row (hidden in versus), reroll and gift (hidden in solo/versus), every row with its
 * description line; a fixed footer with the INSTALLED powerups, READY and UNDO. The cursor is a flat row index
 * over [rows, repair, cards, team, reroll, gift, ready]; a cursor move scrolls its row into view (READY lives in
 * the footer and is always visible). A purchase flashes the panel, a failure shakes it.
 */
import type { PlayerIndex } from '../../contracts/ids';
import type { ShopPanelVM, ShopRowVM } from '../../contracts/ui';
import { InstalledList } from './InstalledList';
import type { PurchaseResult } from '../../contracts/upgrades';
import type { UiContext } from '../view';
import { ClassSwitch, Flag, NumSlot, Shown, TextSlot, ViewPool, button, h } from '../dom';
import { formatHp, formatShards, playerTag } from '../format';
import { ShopRowView } from './ShopRow';

const BUY_FLASH_MS = 220;
const DENY_SHAKE_MS = 320;

/** Flat cursor indices of each section for a panel VM. */
export interface ShopLayout {
  readonly rowsStart: number;
  readonly repair: number;
  readonly cardsStart: number;
  readonly teamStart: number;
  readonly reroll: number;
  /** -1 when Gift is hidden. */
  readonly gift: number;
  readonly ready: number;
  readonly total: number;
}

/** Pure: the flat cursor layout over [rows, repair, cards, team, reroll, gift, ready]. */
export function shopLayout(rows: number, cards: number, team: number, giftVisible: boolean): ShopLayout {
  const repair = rows;
  const cardsStart = repair + 1;
  const teamStart = cardsStart + cards;
  const reroll = teamStart + team;
  const gift = giftVisible ? reroll + 1 : -1;
  const ready = reroll + (giftVisible ? 2 : 1);
  return { rowsStart: 0, repair, cardsStart, teamStart, reroll, gift, ready, total: ready + 1 };
}

/** Pure: the row VM under the cursor (null on READY or out of range). */
export function rowAtCursor(vm: ShopPanelVM, index: number): ShopRowVM | null {
  const l = shopLayout(vm.rows.length, vm.cards.length, vm.team.length, vm.gift !== null);
  if (index < 0) return null;
  if (index < l.repair) return vm.rows[index] ?? null;
  if (index === l.repair) return vm.repair;
  if (index < l.teamStart) return vm.cards[index - l.cardsStart] ?? null;
  if (index < l.reroll) return vm.team[index - l.teamStart] ?? null;
  if (index === l.reroll) return vm.reroll;
  if (index === l.gift) return vm.gift;
  return null;
}

export class ShopPanel {
  readonly el: HTMLElement;
  private readonly player: PlayerIndex;
  private readonly name: TextSlot;
  private readonly wallet: NumSlot;
  private readonly hp: TextSlot;
  private readonly rows: ViewPool<ShopRowView>;
  private readonly repair: ShopRowView;
  private readonly cards: ViewPool<ShopRowView>;
  private readonly team: ViewPool<ShopRowView>;
  private readonly teamShown: Shown;
  private readonly reroll: ShopRowView;
  private readonly gift: ShopRowView;
  private readonly giftShown: Shown;
  private readonly readyBtnText: TextSlot;
  private readonly readyCursor: Flag;
  private readonly readyOn: Flag;
  private readonly undoShown: Shown;
  private readonly installed: InstalledList;
  private readonly toast: TextSlot;
  private readonly body: Shown;
  private readonly absent: Shown;
  private readonly fx: ClassSwitch;
  private lastResult: PurchaseResult | null = null;
  private fxUntil = 0;
  private primed = false;
  private lastCursor = -1;

  constructor(ctx: UiContext, player: PlayerIndex) {
    const doc = ctx.doc;
    const names = ctx.theme.names;
    this.player = player;
    const tag = playerTag(player);
    const nameEl = h(doc, 'span', { className: 'kp-shop-name' });
    const walletEl = h(doc, 'span', { className: 'kp-shop-wallet-num' });
    const hpEl = h(doc, 'span', { className: 'kp-shop-hp' });
    const header = h(
      doc,
      'header',
      { className: 'kp-shop-head' },
      h(doc, 'span', { className: 'kp-tag', text: tag }),
      nameEl,
      h(
        doc,
        'span',
        { className: 'kp-shop-wallet' },
        walletEl,
        h(doc, 'span', { className: 'kp-unit', text: ' ' + names.runCurrency }),
      ),
      hpEl,
    );
    this.name = new TextSlot(nameEl);
    this.wallet = new NumSlot(walletEl, formatShards);
    this.hp = new TextSlot(hpEl);

    const statList = h(doc, 'div', { className: 'kp-shop-stat-list' });
    this.rows = new ViewPool(statList, () => new ShopRowView(doc, 'stat', player));
    this.repair = new ShopRowView(doc, 'plain', player);
    const rowsEl = h(doc, 'div', { className: 'kp-shop-section kp-shop-stats' }, statList, this.repair.el);
    const cardsEl = h(doc, 'div', { className: 'kp-shop-section kp-shop-cards' });
    this.cards = new ViewPool(cardsEl, () => new ShopRowView(doc, 'card', player));
    const teamList = h(doc, 'div', { className: 'kp-shop-team-list' });
    const teamEl = h(
      doc,
      'div',
      { className: 'kp-shop-section kp-shop-team' },
      h(doc, 'h3', { className: 'kp-shop-sub', text: 'TEAM' }),
      teamList,
    );
    this.team = new ViewPool(teamList, () => new ShopRowView(doc, 'plain', player));
    this.teamShown = new Shown(teamEl);
    this.reroll = new ShopRowView(doc, 'plain', player);
    this.gift = new ShopRowView(doc, 'plain', player);
    this.giftShown = new Shown(this.gift.el);
    const utilEl = h(doc, 'div', { className: 'kp-shop-section kp-shop-util' }, this.reroll.el, this.gift.el);

    const readyBtn = button(doc, 'kp-shop-ready', 'READY', 'ready', player, 'ready');
    const undoBtn = button(doc, 'kp-shop-undo', 'UNDO', 'back', player, 'undo');
    this.readyBtnText = new TextSlot(readyBtn);
    this.readyCursor = new Flag(readyBtn, 'is-cursor');
    this.readyOn = new Flag(readyBtn, 'is-ready');
    this.undoShown = new Shown(undoBtn, false);
    const toastEl = h(doc, 'p', { className: 'kp-shop-toast' });
    this.toast = new TextSlot(toastEl);
    this.installed = new InstalledList(doc, 'kp-shop-installed', 'Nothing installed yet');

    const scrollEl = h(
      doc,
      'div',
      { className: 'kp-shop-scroll' },
      h(doc, 'h3', { className: 'kp-shop-sub', text: 'SYSTEMS' }),
      rowsEl,
      h(doc, 'h3', { className: 'kp-shop-sub', text: 'PATCH CARDS' }),
      cardsEl,
      teamEl,
      utilEl,
    );
    const footEl = h(
      doc,
      'div',
      { className: 'kp-shop-foot' },
      h(doc, 'h3', { className: 'kp-shop-sub', text: 'INSTALLED' }),
      this.installed.el,
      h(doc, 'div', { className: 'kp-shop-actions' }, readyBtn, undoBtn),
      toastEl,
    );
    const bodyEl = h(doc, 'div', { className: 'kp-shop-body' }, scrollEl, footEl);
    const absentEl = h(doc, 'p', { className: 'kp-shop-absent', text: `${tag} NOT CONNECTED` });
    this.body = new Shown(bodyEl);
    this.absent = new Shown(absentEl, false);
    this.el = h(
      doc,
      'article',
      { className: `kp-shop-panel kp-${tag.toLowerCase()}` },
      header,
      bodyEl,
      absentEl,
    );
    this.fx = new ClassSwitch(this.el);
  }

  /** New visit: the first render adopts lastResult without replaying its flash. */
  reset(): void {
    this.primed = false;
    this.fxUntil = 0;
    this.lastCursor = -1;
  }

  /** The row element under a cursor index (null on READY, which sits in the always-visible footer). */
  private rowEl(cur: number, l: ShopLayout): HTMLElement | null {
    if (cur < l.repair) return cur < this.rows.count ? this.rows.get(cur).el : null;
    if (cur === l.repair) return this.repair.el;
    if (cur < l.teamStart)
      return cur - l.cardsStart < this.cards.count ? this.cards.get(cur - l.cardsStart).el : null;
    if (cur < l.reroll)
      return cur - l.teamStart < this.team.count ? this.team.get(cur - l.teamStart).el : null;
    if (cur === l.reroll) return this.reroll.el;
    if (cur === l.gift) return this.gift.el;
    return null;
  }

  /** Keeps the cursor row visible inside the scrolling list (only on cursor moves, never per frame). */
  private scrollToCursor(cur: number, l: ShopLayout): void {
    const el = this.rowEl(cur, l);
    if (el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }

  /** Returns true while a buy flash / deny shake is running (the screen re-renders to end it). */
  render(vm: ShopPanelVM, nowMs: number): boolean {
    this.name.set(vm.name);
    this.body.set(vm.present);
    this.absent.set(!vm.present);
    if (!vm.present) {
      this.fx.set(null);
      return false;
    }
    this.wallet.set(vm.wallet);
    this.hp.set(formatHp(vm.hp, vm.maxHp));

    const l = shopLayout(vm.rows.length, vm.cards.length, vm.team.length, vm.gift !== null);
    const cur = vm.cursor.row;
    const col = vm.cursor.col;
    this.rows.ensure(vm.rows.length);
    for (let i = 0; i < vm.rows.length; i++) this.rows.get(i).set(vm.rows[i]!, cur === l.rowsStart + i, 0);
    this.repair.set(vm.repair, cur === l.repair, 0);
    this.cards.ensure(vm.cards.length);
    for (let i = 0; i < vm.cards.length; i++) {
      this.cards.get(i).setCard(vm.cards[i]!, cur === l.cardsStart + i, col);
    }
    this.teamShown.set(vm.team.length > 0);
    this.team.ensure(vm.team.length);
    for (let i = 0; i < vm.team.length; i++) this.team.get(i).set(vm.team[i]!, cur === l.teamStart + i, 0);
    this.reroll.set(vm.reroll, cur === l.reroll, 0);
    this.giftShown.set(vm.gift !== null);
    if (vm.gift !== null) this.gift.set(vm.gift, cur === l.gift, 0);
    this.readyCursor.set(cur === l.ready);
    this.readyOn.set(vm.ready);
    this.readyBtnText.set(vm.ready ? 'READY ✓' : 'READY');
    this.undoShown.set(vm.canUndo);

    this.installed.render(vm.installed);
    this.toast.set(vm.toast ?? '');
    // A purchase can make the cursor row's text wrap onto another line: re-check visibility then too.
    const bought = vm.lastResult !== this.lastResult;
    if (cur !== this.lastCursor || bought) {
      this.lastCursor = cur;
      this.scrollToCursor(cur, l);
    }

    if (bought) {
      this.lastResult = vm.lastResult;
      if (vm.lastResult !== null && this.primed) {
        this.fx.set(vm.lastResult.ok ? 'fx-buy' : 'fx-deny');
        this.fxUntil = nowMs + (vm.lastResult.ok ? BUY_FLASH_MS : DENY_SHAKE_MS);
      }
    }
    this.primed = true;
    if (nowMs >= this.fxUntil) {
      this.fx.set(null);
      return false;
    }
    return true;
  }

  get playerIndex(): PlayerIndex {
    return this.player;
  }
}
