import { describe, expect, it } from 'vitest';
import { statRowPrice, rerollPrice } from '../../src/upgrades/pricing';
import { expectFail, expectOk, makeShop, stacks, team, tx, wallet } from './shopFixture';

describe('ShopModel: transactions', () => {
  it('an exact-funds buy leaves a zero balance', () => {
    const price = statRowPrice('thrusters', 0, 5);
    const shop = makeShop({ wave: 5, p0: { wallet: price } });
    const r = expectOk(shop.apply(tx.row(0, 'thrusters')));
    expect(r.price).toBe(price);
    expect(r.balance).toBe(0);
  });

  it('a double buy in one frame charges two escalating prices', () => {
    const shop = makeShop();
    const res = shop.applyBatch([tx.row(0, 'plating'), tx.row(0, 'plating')]);
    expect(res.map((r) => (r.ok ? r.price : -1))).toEqual([25, 35]);
    expect(wallet(shop, 0)).toBe(1000 - 60);
  });

  it('applyBatch processes P1 before P2 regardless of submission order', () => {
    const shop = makeShop({ team: team({ kernels: 2 }) });
    const res = shop.applyBatch([tx.team(1, 'spareKernel'), tx.row(1, 'plating'), tx.team(0, 'spareKernel')]);
    expectOk(res[2]!);
    expect(expectFail(res[0]!)).toBe('soldOut');
    expectOk(res[1]!);
    expect(shop.snapshot().kernels).toBe(3);
  });

  it('Plating heals by the delta; undo restores hp and maxHp exactly and refunds the price paid', () => {
    const shop = makeShop({ wave: 3, p0: { hp: 50 } });
    const r = expectOk(shop.apply(tx.row(0, 'plating')));
    let p = shop.snapshot().players[0];
    expect(p.maxHp).toBe(120);
    expect(p.hp).toBe(70);
    const u = expectOk(shop.apply(tx.undo(0)));
    expect(u.price).toBe(r.price);
    expect(u.txId).toBe(r.txId);
    p = shop.snapshot().players[0];
    expect([p.hp, p.maxHp, p.wallet]).toEqual([50, 100, 1000]);
    expect(p.rows.find((x) => x.id === 'plating')!.level).toBe(0);
  });

  it('Glass Lens lowers max HP (hp clamped >= 1) and undo restores it', () => {
    const shop = makeShop({ p0: { hp: 95 }, locked: [{ id: 'glassLens', price: 120 }, null] });
    expectOk(shop.apply(tx.card(0, 0)));
    let p = shop.snapshot().players[0];
    expect(p.maxHp).toBe(80);
    expect(p.hp).toBe(80);
    expect(shop.results().locked[0]).toBeNull();
    expectOk(shop.apply(tx.undo(0)));
    p = shop.snapshot().players[0];
    expect([p.hp, p.maxHp]).toEqual([95, 100]);
    expect(shop.snapshot().players[0].cards[0]!.locked).toBe(true);
    expect(shop.results().locked[0]).toEqual({ id: 'glassLens', price: 120 });
  });

  it('Repair undo restores hp and the visit counter', () => {
    const shop = makeShop({ p0: { hp: 30 } });
    expectOk(shop.apply(tx.repair(0)));
    expectOk(shop.apply(tx.undo(0)));
    const p = shop.snapshot().players[0];
    expect(p.hp).toBe(30);
    expect(p.repair.boughtThisVisit).toBe(0);
    expect(p.repair.price).toBe(20);
  });

  it('undo refunds the price actually paid, not a recomputed price', () => {
    const shop = makeShop({ locked: [{ id: 'pierce', price: 40 }, null] });
    const r = expectOk(shop.apply(tx.card(0, 0)));
    expect(r.price).toBe(40);
    expect(expectOk(shop.apply(tx.undo(0))).price).toBe(40);
    expect(wallet(shop, 0)).toBe(1000);
  });

  it('gift moves 10 Shards to the partner (co-op only) and the giver can undo it', () => {
    const shop = makeShop({ p0: { wallet: 10 }, p1: { wallet: 5 } });
    const r = expectOk(shop.apply(tx.gift(0)));
    expect(r.price).toBe(10);
    expect([wallet(shop, 0), wallet(shop, 1)]).toEqual([0, 15]);
    expect(expectFail(shop.apply(tx.gift(0)))).toBe('funds');
    expect(expectFail(shop.apply(tx.undo(1)))).toBe('nothingToUndo');
    expectOk(shop.apply(tx.undo(0)));
    expect([wallet(shop, 0), wallet(shop, 1)]).toEqual([10, 5]);
  });

  it('team purchases undo only by their buyer while on top of the team log', () => {
    const shop = makeShop();
    expectOk(shop.apply(tx.team(0, 'spareKernel')));
    expect(shop.snapshot().kernels).toBe(2);
    expect(expectFail(shop.apply(tx.undo(1)))).toBe('nothingToUndo');
    expectOk(shop.apply(tx.undo(0)));
    expect(shop.snapshot().kernels).toBe(1);
    expect(shop.results().team.kernelsBoughtThisRun).toBe(0);
    // After undo the same frame allows the partner to buy it.
    expectOk(shop.apply(tx.team(1, 'spareKernel')));
    expect(shop.results().team).toMatchObject({ kernels: 2, kernelsBoughtThisRun: 1 });
    expect(shop.snapshot().players[0].team.find((t) => t.id === 'spareKernel')!.status).toBe('soldOut');
  });

  it('reroll escalates, consumes free Firmware rerolls first and is never refundable', () => {
    const shop = makeShop({ wave: 10, meta: { rerollCache: 2 } });
    const before = shop.snapshot().players[0].cards.map((c) => c.id);
    expect(shop.snapshot().players[0].reroll).toEqual({ price: 0, freeLeft: 2 });
    expect(expectOk(shop.apply(tx.reroll(0))).price).toBe(0);
    expect(expectOk(shop.apply(tx.reroll(0))).price).toBe(0);
    const p1 = expectOk(shop.apply(tx.reroll(0))).price;
    const p2 = expectOk(shop.apply(tx.reroll(0))).price;
    expect([p1, p2]).toEqual([rerollPrice(0, 10), rerollPrice(1, 10)]);
    expect(p2).toBeGreaterThan(p1);
    expect(expectFail(shop.apply(tx.undo(0)))).toBe('nothingToUndo');
    expect(wallet(shop, 0)).toBe(1000 - p1 - p2);
    expect(shop.snapshot().players[0].cards.map((c) => c.id)).not.toEqual(before);
  });

  it('a reroll keeps the locked card; the lock toggles and moves; results carry it to the next visit', () => {
    const shop = makeShop({ seed: 77 });
    const card1 = shop.snapshot().players[0].cards[1]!;
    expectOk(shop.apply(tx.lock(0, 1)));
    expect(shop.snapshot().players[0].cards[1]!.locked).toBe(true);
    expectOk(shop.apply(tx.reroll(0)));
    const after = shop.snapshot().players[0].cards;
    expect(after[0]).toMatchObject({ id: card1.id, price: card1.price, locked: true });
    expectOk(shop.apply(tx.lock(0, 2)));
    expect(shop.snapshot().players[0].cards.filter((c) => c.locked)).toHaveLength(1);
    expectOk(shop.apply(tx.lock(0, 2)));
    expect(shop.snapshot().players[0].cards.some((c) => c.locked)).toBe(false);
    expectOk(shop.apply(tx.lock(0, 0)));
    shop.commit();
    expect(shop.results().locked[0]).toEqual({ id: card1.id, price: card1.price });
  });

  it('Shard Cache grants 25 Shards for free and undo removes them', () => {
    const own = stacks({
      splitShot: 2,
      overdriveBattery: 3,
      bounty: 2,
      pierce: 3,
      vampireCode: 2,
      afterimage: 1,
      doubleBuffer: 1,
      overheat: 1,
      ricochet: 2,
      chainArc: 1,
      microMissiles: 2,
      nanoshield: 1,
      orbitals: 1,
      glassLens: 1,
    });
    const shop = makeShop({ p0: { cards: own, wallet: 0, hp: 50 } });
    const offer = shop.snapshot().players[0].cards[0]!;
    expect(offer.id).toBe('shardCache');
    expect(offer.price).toBe(0);
    expectOk(shop.apply(tx.card(0, 0)));
    expect(wallet(shop, 0)).toBe(25);
    expect(shop.ledger()).toEqual({ spent: 0, refunded: 0, granted: 25 });
    expectOk(shop.apply(tx.undo(0)));
    expect(wallet(shop, 0)).toBe(0);
    expect(shop.ledger().granted).toBe(0);
  });

  it('ready: every joined player, 1.5 s countdown, cancelled by un-readying; final visit needs a choice', () => {
    const shop = makeShop();
    expectOk(shop.apply(tx.ready(0)));
    shop.update(2000);
    expect(shop.allReady).toBe(false);
    expectOk(shop.apply(tx.ready(1)));
    expect(shop.allReady).toBe(true);
    shop.update(1000);
    expect(shop.snapshot().countdownMs).toBe(500);
    expectOk(shop.apply(tx.ready(1)));
    shop.update(16);
    expect(shop.snapshot().countdownMs).toBeNull();
    expectOk(shop.apply(tx.ready(1)));
    shop.update(1500);
    expect(shop.countdownDone).toBe(true);

    const fin = makeShop({ finalVisit: true, mode: 'solo' });
    expect(fin.finalVisit).toBe(true);
    expectOk(fin.apply(tx.ready(0)));
    fin.update(5000);
    expect(fin.countdownDone).toBe(false);
    expectOk(fin.apply({ kind: 'choose', player: 0, choice: 'pushDeeper' }));
    fin.update(1500);
    expect(fin.countdownDone).toBe(true);
    expect(fin.choice).toBe('pushDeeper');
    expect(fin.results().choice).toBe('pushDeeper');
  });

  it('commit clears the logs; results are deep copies', () => {
    const shop = makeShop();
    expectOk(shop.apply(tx.row(0, 'plating')));
    expectOk(shop.apply(tx.team(1, 'linkAmp')));
    expect(shop.logDepth(0)).toBe(1);
    shop.commit();
    expect(shop.logDepth(0)).toBe(0);
    expect(shop.logDepth(1)).toBe(0);
    const r = shop.results();
    expect(r.players[0].rows.plating).toBe(1);
    expect(r.team.levels.linkAmp).toBe(1);
    r.players[0].cards[0] = 9;
    expect(shop.results().players[0].cards[0]).toBe(0);
  });

  it('snapshot reports statuses, prices and undo availability', () => {
    const shop = makeShop({ p0: { wallet: 30 } });
    let s = shop.snapshot().players[0];
    expect(s.rows.find((r) => r.id === 'plating')).toMatchObject({ price: 25, status: 'available' });
    expect(s.rows.find((r) => r.id === 'overclock')).toMatchObject({ price: 35, status: 'unaffordable' });
    expect(s.canUndo).toBe(false);
    expectOk(shop.apply(tx.row(0, 'plating')));
    s = shop.snapshot().players[0];
    expect(s.canUndo).toBe(true);
    expect(s.lastResult?.ok).toBe(true);
    expect(s.repair.status).toBe('maxed');
    expect(shop.snapshot().players).toBe(shop.snapshot().players); // cached until the state changes
  });

  it('solo hides gift, rejects P2 and never draws offers for P2', () => {
    const shop = makeShop({ mode: 'solo' });
    const snap = shop.snapshot();
    expect(snap.giftVisible).toBe(false);
    expect(snap.players[1].cards).toHaveLength(0);
    expectOk(shop.apply(tx.ready(0)));
    expect(shop.allReady).toBe(true);
  });

  it('coerces invalid incoming wallets (DEV assert) instead of trusting them', () => {
    expect(() => makeShop({ p0: { wallet: -5 } })).toThrow();
    expect(() => makeShop({ p0: { wallet: Number.NaN } })).toThrow();
  });
});
