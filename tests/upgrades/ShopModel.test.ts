import { describe, expect, it } from 'vitest';
import type { PurchaseFailure, ShopTx } from '../../src/contracts/upgrades';
import { UTILITY_PRICES } from '../../src/config/runCatalog';
import { ECONOMY } from '../../src/config/tuning';
import { statRowPrice, rerollPrice } from '../../src/upgrades/pricing';
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
    const rows = { thrusters: 6, plating: 0, overclock: 0, payload: 0, magnet: 0, coolant: 0, capacitor: 0, specialTuning: 0 };
    const shop = makeShop({ p0: { rows } });
    expect(note(expectFail(shop.apply(tx.row(0, 'thrusters'))))).toBe('maxLevel');
    const s2 = makeShop({ p0: { cards: stacks({ pierce: 3 }) }, locked: [{ id: 'pierce', price: 75 }, null] });
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
    const shop = makeShop({ p0: { cards: stacks({ chainArc: 1 }) }, locked: [{ id: 'chainArc', price: 120 }, null] });
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
    const own = stacks({ splitShot: 2, overdriveBattery: 3, bounty: 2, pierce: 3, vampireCode: 2, afterimage: 1, doubleBuffer: 1, overheat: 1, ricochet: 2, chainArc: 1, microMissiles: 2, nanoshield: 1, orbitals: 1, glassLens: 1 });
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
