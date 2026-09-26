import { describe, expect, it } from 'vitest';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { ShopScreen } from '../../src/ui/screens/ShopScreen';
import { rowAtCursor, shopLayout } from '../../src/ui/widgets/ShopPanel';
import { FakeDocument, asDocument, asFake, type FakeElement } from './fakeDom';
import { card, hangarVM, row, shopPanelVM, shopVM } from './fixtures';
import { HangarScreen } from '../../src/ui/screens/HangarScreen';

function makeShop() {
  const s = new ShopScreen({ doc: asDocument(new FakeDocument()), theme: KERNEL_PANIC });
  return { s, el: asFake(s.el) };
}

const visibleRows = (panel: FakeElement): FakeElement[] => panel.byClass('kp-row').filter((r) => r.visible);

describe('ui/shop layout (pure)', () => {
  it('flat cursor order is rows, repair, cards, team, reroll, gift, ready', () => {
    expect(shopLayout(8, 3, 4, true)).toEqual({
      rowsStart: 0,
      repair: 8,
      cardsStart: 9,
      teamStart: 12,
      reroll: 16,
      gift: 17,
      ready: 18,
      total: 19,
    });
    const vs = shopLayout(8, 3, 0, false);
    expect(vs.teamStart).toBe(vs.reroll);
    expect(vs.gift).toBe(-1);
    expect(vs.ready).toBe(13);
  });

  it('rowAtCursor maps indices back to VMs', () => {
    const vm = shopPanelVM(0);
    expect(rowAtCursor(vm, 0)!.id).toBe('thrusters');
    expect(rowAtCursor(vm, 2)!.id).toBe('repair');
    expect(rowAtCursor(vm, 4)!.id).toBe('pierce');
    expect(rowAtCursor(vm, 7)!.id).toBe('linkAmp');
    expect(rowAtCursor(vm, 8)!.id).toBe('reroll');
    expect(rowAtCursor(vm, 9)!.id).toBe('gift');
    expect(rowAtCursor(vm, 10)).toBeNull();
    expect(rowAtCursor(vm, -1)).toBeNull();
  });
});

describe('ui/ShopScreen', () => {
  it('renders both panels with prices, statuses and theme currency', () => {
    const { s, el } = makeShop();
    s.render(
      shopVM({
        panels: [
          shopPanelVM(0, {
            rows: [row('thrusters', { status: 'maxed', price: null }), row('plating', { status: 'unaffordable' })],
          }),
          shopPanelVM(1),
        ],
      }),
      0,
    );
    const [p1, p2] = el.byClass('kp-shop-panel');
    expect(p1!.classList.contains('kp-p1')).toBe(true);
    expect(p2!.classList.contains('kp-p2')).toBe(true);
    expect(p1!.first('kp-shop-wallet-num').textContent).toBe('250');
    expect(p1!.first('kp-shop-wallet').textContent).toContain('Bits');
    const rows = visibleRows(p1!);
    expect(rows[0]!.first('kp-row-price').textContent).toBe('MAX');
    expect(rows[0]!.classList.contains('st-maxed')).toBe(true);
    expect(rows[1]!.classList.contains('st-unaffordable')).toBe(true);
    expect(rows[1]!.first('kp-row-price').textContent).toBe('40');
    expect(rows[1]!.first('kp-row-level').textContent).toBe('1/5');
    expect(el.first('kp-team-strip').hidden).toBe(false);
    expect(el.first('kp-team-strip').textContent).toContain('SPARE KERNELS');
  });

  it('cursor highlights, card Buy/Lock columns and lock item ids', () => {
    const { s, el } = makeShop();
    s.render(shopVM({ panels: [shopPanelVM(0, { cursor: { row: 4, col: 1 } }), shopPanelVM(1)] }), 0);
    const p1 = el.byClass('kp-shop-panel')[0]!;
    const cards = p1.byClass('kp-row-card').filter((r) => r.visible);
    expect(cards.length).toBe(3);
    const pierce = cards[1]!;
    expect(pierce.classList.contains('is-cursor')).toBe(true);
    expect(pierce.classList.contains('is-col-lock')).toBe(true);
    expect(pierce.classList.contains('is-locked')).toBe(true);
    expect(pierce.classList.contains('rar-l')).toBe(true);
    expect(pierce.first('kp-row-level').textContent).toBe('LEGENDARY');
    expect(pierce.first('kp-row-lock').textContent).toBe('LOCKED');
    expect(pierce.first('kp-row-lock').getAttribute('data-item')).toBe('lock:pierce');
    expect(pierce.first('kp-row-lock').getAttribute('data-player')).toBe('0');
    expect(pierce.first('kp-row-buy').getAttribute('data-item')).toBe('pierce');
    expect(p1.first('kp-shop-detail').textContent).toBe('pierce blurb');
    s.render(shopVM({ panels: [shopPanelVM(0, { cursor: { row: 10, col: 0 }, ready: true }), shopPanelVM(1)] }), 0);
    const ready = p1.first('kp-shop-ready');
    expect(ready.classList.contains('is-cursor')).toBe(true);
    expect(ready.classList.contains('is-ready')).toBe(true);
    expect(ready.getAttribute('data-kind')).toBe('ready');
    expect(p1.first('kp-shop-detail').textContent).toBe('');
  });

  it('versus hides the team row, team strip and gift', () => {
    const { s, el } = makeShop();
    const vsPanel = (p: 0 | 1) => shopPanelVM(p, { team: [], gift: null });
    s.render(shopVM({ mode: 'versus', teamVisible: false, panels: [vsPanel(0), vsPanel(1)] }), 0);
    expect(el.classList.contains('mode-versus')).toBe(true);
    expect(el.first('kp-team-strip').hidden).toBe(true);
    for (const panel of el.byClass('kp-shop-panel')) {
      expect(panel.first('kp-shop-team').hidden).toBe(true);
      const ids = visibleRows(panel).map((r) => r.first('kp-row-buy').getAttribute('data-item'));
      expect(ids).not.toContain('gift');
      expect(ids).not.toContain('linkAmp');
      expect(ids).toContain('reroll');
    }
  });

  it('absent P2 panel shows NOT CONNECTED', () => {
    const { s, el } = makeShop();
    s.render(shopVM({ mode: 'solo', panels: [shopPanelVM(0), shopPanelVM(1, { present: false })] }), 0);
    const p2 = el.byClass('kp-shop-panel')[1]!;
    expect(p2.first('kp-shop-body').hidden).toBe(true);
    expect(p2.first('kp-shop-absent').hidden).toBe(false);
    expect(el.classList.contains('mode-solo')).toBe(true);
  });

  it('deny shake and buy flash are timed and ask for another render', () => {
    const { s, el } = makeShop();
    s.onShow();
    s.render(shopVM(), 0);
    const p1 = el.byClass('kp-shop-panel')[0]!;
    const denied = shopVM({
      panels: [shopPanelVM(0, { lastResult: { ok: false, reason: 'funds' }, toast: 'Not enough Bits' }), shopPanelVM(1)],
    });
    expect(s.render(denied, 100)).toBe(true);
    expect(p1.classList.contains('fx-deny')).toBe(true);
    expect(p1.first('kp-shop-toast').textContent).toBe('Not enough Bits');
    expect(s.render(denied, 500)).toBe(false);
    expect(p1.classList.contains('fx-deny')).toBe(false);
    const bought = shopVM({
      panels: [shopPanelVM(0, { lastResult: { ok: true, price: 40, balance: 210, txId: 3 }, canUndo: true }), shopPanelVM(1)],
    });
    expect(s.render(bought, 600)).toBe(true);
    expect(p1.classList.contains('fx-buy')).toBe(true);
    expect(p1.first('kp-shop-undo').hidden).toBe(false);
  });

  it('a result present on the first render of a visit does not replay its flash', () => {
    const { s, el } = makeShop();
    s.onShow();
    const vm = shopVM({ panels: [shopPanelVM(0, { lastResult: { ok: false, reason: 'funds' } }), shopPanelVM(1)] });
    expect(s.render(vm, 0)).toBe(false);
    expect(el.byClass('kp-shop-panel')[0]!.classList.contains('fx-deny')).toBe(false);
  });

  it('final visit shows EXTRACT / PUSH DEEPER with selection and countdown', () => {
    const { s, el } = makeShop();
    s.render(
      shopVM({
        finalChoice: { visible: true, selected: 'pushDeeper', extractLabel: 'EXTRACT', pushLabel: 'PUSH DEEPER' },
        countdown: 1.2,
      }),
      0,
    );
    expect(el.first('kp-final').hidden).toBe(false);
    expect(el.first('kp-final-push').classList.contains('is-selected')).toBe(true);
    expect(el.first('kp-final-extract').classList.contains('is-selected')).toBe(false);
    expect(el.first('kp-final-extract').getAttribute('data-item')).toBe('extract');
    expect(el.first('kp-shop-countdown').textContent).toBe('LAUNCH 1.2');
  });

  it('card with bought slot keeps working with other statuses', () => {
    const { s, el } = makeShop();
    s.render(
      shopVM({
        panels: [shopPanelVM(0, { cards: [card('slot0', { status: 'soldOut' })] }), shopPanelVM(1)],
      }),
      0,
    );
    const cards = el.byClass('kp-shop-panel')[0]!.byClass('kp-row-card').filter((r) => r.visible);
    expect(cards.length).toBe(1);
    expect(cards[0]!.first('kp-row-price').textContent).toBe('SOLD OUT');
  });
});

describe('ui/HangarScreen', () => {
  it('renders items, cursor detail, respec refund and read-only', () => {
    const h = new HangarScreen({ doc: asDocument(new FakeDocument()), theme: KERNEL_PANIC });
    const el = asFake(h.el);
    h.render(hangarVM());
    const rows = el.byClass('kp-row').filter((r) => r.visible);
    expect(rows.length).toBe(3);
    expect(rows[0]!.classList.contains('is-cursor')).toBe(true);
    expect(rows[0]!.first('kp-row-level').textContent).toBe('1/5');
    expect(rows[1]!.first('kp-row-level').hidden).toBe(true);
    expect(el.first('kp-hangar-refund').hidden).toBe(true);
    h.render(hangarVM({ cursor: 2, readOnly: true, message: 'Bought' }));
    expect(el.first('kp-hangar-refund').hidden).toBe(false);
    expect(el.first('kp-hangar-refund').textContent).toBe('REFUND +120 Cores');
    expect(rows[2]!.first('kp-row-price').textContent).toBe('—');
    expect(el.first('kp-hangar-ro').hidden).toBe(false);
    expect(el.classList.contains('is-readonly')).toBe(true);
    expect(el.first('kp-hangar-msg').textContent).toBe('Bought');
    expect(el.first('kp-cores-num').textContent).toBe('300');
  });
});
