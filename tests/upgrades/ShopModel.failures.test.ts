import { describe, expect, it } from 'vitest';
import type { PurchaseFailure, ShopTx } from '../../src/contracts/upgrades';
import { UTILITY_PRICES } from '../../src/config/runCatalog';
import { ECONOMY } from '../../src/config/tuning';
import { expectFail, expectOk, makeShop, stacks, team, tx, wallet } from './shopFixture';

describe('ShopModel: every PurchaseFailure is reachable', () => {
  const seen = new Set<PurchaseFailure>();
  const note = (reason: string): string => {
    seen.add(reason as PurchaseFailure);
    return reason;
  };

  it('funds', () => {
    const shop = makeShop({ p0: { wallet: 29 } });
    expect(note(expectFail(shop.apply(tx.row(0, 'thrusters'))))).toBe('funds');
  });

  it('maxLevel (stat row and card stack cap)', () => {
    const rows = {
      thrusters: 6,
      plating: 0,
      overclock: 0,
      payload: 0,
      magnet: 0,
      coolant: 0,
      capacitor: 0,
      specialTuning: 0,
    };
    const shop = makeShop({ p0: { rows } });
    expect(note(expectFail(shop.apply(tx.row(0, 'thrusters'))))).toBe('maxLevel');
    const s2 = makeShop({
      p0: { cards: stacks({ pierce: 3 }) },
      locked: [{ id: 'pierce', price: 75 }, null],
    });
    expect(expectFail(s2.apply(tx.card(0, 0)))).toBe('maxLevel');
  });

  it('capped: a row whose only stat sits at its hard cap', () => {
    const shop = makeShop({ caps: { damageMulMax: 1.15 } });
    expectOk(shop.apply(tx.row(0, 'payload')));
    expect(note(expectFail(shop.apply(tx.row(0, 'payload'))))).toBe('capped');
    const row = shop.snapshot().players[0].rows.find((r) => r.id === 'payload')!;
    expect(row.status).toBe('capped');
  });

  it('capped rows still sell when the fire-rate overflow converts into damage', () => {
    const shop = makeShop({ caps: { fireRateMax: 9.5 } });
    expectOk(shop.apply(tx.row(0, 'overclock')));
    // Fire rate is capped but the overflow keeps raising damage.
    expectOk(shop.apply(tx.row(0, 'overclock')));
  });

  it('soldOut: team stock bought by the partner in the same frame, and a bought card slot', () => {
    const shop = makeShop();
    const res = shop.applyBatch([tx.team(1, 'linkAmp'), tx.team(0, 'linkAmp')]);
    expectOk(res[1]!); // P1 first
    expect(note(expectFail(res[0]!))).toBe('soldOut');
    expect(wallet(shop, 1)).toBe(1000); // no charge
    shop.update(16);
    expectOk(shop.apply(tx.team(1, 'linkAmp'))); // next frame: level 2 is for sale again
    expectOk(shop.apply(tx.card(0, 1)));
    expect(expectFail(shop.apply(tx.card(0, 1)))).toBe('soldOut');
  });

  it('unavailable: team row and gift in versus, gift in solo, Legendary without the pool, choose off-final', () => {
    const vs = makeShop({ mode: 'versus', round: 2 });
    expect(note(expectFail(vs.apply(tx.team(0, 'spareKernel'))))).toBe('unavailable');
    expect(expectFail(vs.apply(tx.team(1, 'linkRange')))).toBe('unavailable');
    expect(expectFail(vs.apply(tx.gift(0)))).toBe('unavailable');
    const snap = vs.snapshot();
    expect(snap.teamVisible).toBe(false);
    expect(snap.giftVisible).toBe(false);
    expect(snap.round).toBe(2);
    expect(snap.players[0].team.every((t) => t.status === 'unavailable')).toBe(true);
    expect(snap.players[0].gift.status).toBe('unavailable');
    const solo = makeShop({ mode: 'solo' });
    expect(expectFail(solo.apply(tx.gift(0)))).toBe('unavailable');
    const leg = makeShop({ locked: [{ id: 'sudo', price: 190 }, null] });
    expect(expectFail(leg.apply(tx.card(0, 0)))).toBe('unavailable');
    expect(expectFail(leg.apply({ kind: 'choose', player: 0, choice: 'extract' }))).toBe('unavailable');
  });

  it('absent: solo P2 transactions', () => {
    const shop = makeShop({ mode: 'solo' });
    for (const t of [tx.row(1, 'plating'), tx.undo(1), tx.ready(1), tx.gift(1)] as ShopTx[])
      expect(note(expectFail(shop.apply(t)))).toBe('absent');
    expect(shop.snapshot().players[1].joined).toBe(false);
  });

  it('fullHp and visitLimit on Repair', () => {
    const shop = makeShop({ p0: { hp: 100 } });
    expect(note(expectFail(shop.apply(tx.repair(0))))).toBe('fullHp');
    const hurt = makeShop({ p0: { hp: 10 } });
    const a = expectOk(hurt.apply(tx.repair(0)));
    const b = expectOk(hurt.apply(tx.repair(0)));
    expect(a.price).toBe(20);
    expect(b.price).toBe(30); // x1.5 per further buy
    expect(note(expectFail(hurt.apply(tx.repair(0))))).toBe('visitLimit');
    expect(hurt.snapshot().players[0].hp).toBe(80); // 10 + 35 + 35
    expect(hurt.snapshot().players[0].repair.price).toBeNull();
  });

  it('visitLimit on a Spare Kernel (1 per visit)', () => {
    const shop = makeShop();
    expectOk(shop.apply(tx.team(0, 'spareKernel')));
    expect(expectFail(shop.apply(tx.team(0, 'spareKernel')))).toBe('visitLimit');
  });

  it('heldCap: at most 3 Spare Kernels held; gift into a full wallet', () => {
    const shop = makeShop({ team: team({ kernels: 3 }) });
    expect(note(expectFail(shop.apply(tx.team(0, 'spareKernel'))))).toBe('heldCap');
    const full = makeShop({ p1: { wallet: ECONOMY.WALLET_MAX } });
    expect(expectFail(full.apply(tx.gift(0)))).toBe('heldCap');
  });

  it('alreadyOwned: a locked unique that is already owned', () => {
    const shop = makeShop({
      p0: { cards: stacks({ chainArc: 1 }) },
      locked: [{ id: 'chainArc', price: 120 }, null],
    });
    expect(note(expectFail(shop.apply(tx.card(0, 0))))).toBe('alreadyOwned');
    expect(shop.snapshot().players[0].cards[0]!.status).toBe('owned');
  });

  it('nothingToUndo: empty log, and a reroll barrier', () => {
    const shop = makeShop();
    expect(note(expectFail(shop.apply(tx.undo(0))))).toBe('nothingToUndo');
    expectOk(shop.apply(tx.row(0, 'magnet')));
    expectOk(shop.apply(tx.reroll(0)));
    expect(expectFail(shop.apply(tx.undo(0)))).toBe('nothingToUndo');
  });

  it('teamDependency: a team buy covered by a later team buy, and partner-spent gift', () => {
    const shop = makeShop();
    expectOk(shop.apply(tx.team(0, 'linkRange')));
    expectOk(shop.apply(tx.team(1, 'linkAmp')));
    expect(note(expectFail(shop.apply(tx.undo(0))))).toBe('teamDependency');
    expectOk(shop.apply(tx.undo(1)));
    expectOk(shop.apply(tx.undo(0)));
    const g = makeShop({ p1: { wallet: 20 } });
    expectOk(g.apply(tx.gift(0)));
    expectOk(g.apply(tx.row(1, 'thrusters'))); // spends the gift (price 30 of 30)
    expect(expectFail(g.apply(tx.undo(0)))).toBe('teamDependency');
  });

  it('guard: the 350 ms open guard rejects a held press', () => {
    const shop = makeShop({ skipGuard: false });
    expect(shop.snapshot().guardActive).toBe(true);
    expect(note(expectFail(shop.apply(tx.row(0, 'plating'))))).toBe('guard');
    shop.update(UTILITY_PRICES.openGuardMs - 1);
    expect(expectFail(shop.apply(tx.ready(0)))).toBe('guard');
    shop.update(1);
    expect(shop.snapshot().guardActive).toBe(false);
    expectOk(shop.apply(tx.row(0, 'plating')));
  });

  it('invalid: malformed txs, locking a bought slot, buying while Ready, after commit', () => {
    const shop = makeShop();
    const bad = [
      { kind: 'buyRow', player: 3, id: 'plating' },
      { kind: 'buyRow', player: 0, id: 'nope' },
      { kind: 'buyCard', player: 0, slot: 7 },
      { kind: 'teleport', player: 0 },
      { kind: 'choose', player: 0, choice: 'maybe' },
    ] as unknown as ShopTx[];
    for (const t of bad) expect(note(expectFail(shop.apply(t)))).toBe('invalid');
    expectOk(shop.apply(tx.card(0, 2)));
    expect(expectFail(shop.apply(tx.lock(0, 2)))).toBe('invalid');
    expectOk(shop.apply(tx.ready(0)));
    expect(expectFail(shop.apply(tx.row(0, 'plating')))).toBe('invalid');
    shop.commit();
    expect(expectFail(shop.apply(tx.ready(0)))).toBe('invalid');
  });

  it('covers all 14 failure reasons', () => {
    expect([...seen].sort()).toEqual(
      [
        'absent',
        'alreadyOwned',
        'capped',
        'funds',
        'fullHp',
        'guard',
        'heldCap',
        'invalid',
        'maxLevel',
        'nothingToUndo',
        'soldOut',
        'teamDependency',
        'unavailable',
        'visitLimit',
      ].sort(),
    );
  });
});
