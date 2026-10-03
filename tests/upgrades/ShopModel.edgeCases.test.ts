/**
 * ShopModel edge cases:
 * 1. The same-frame team 'soldOut' ends with the frame: update() re-snapshots, so the partner does not keep
 *    seeing SOLD OUT for a multi-level team item that apply() sells again.
 * 2. The wallet stays in [0, WALLET_MAX] on undo: when gifts refilled the wallet, an exact refund would
 *    overflow, so the undo is refused ('heldCap') instead of clamping (which would burn Shards).
 */
import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../src/config/tuning';
import { expectOk, makeShop, tx, wallet } from './shopFixture';

describe('ECON: team soldOut must not outlive its frame in the snapshot', () => {
  it('P2 sees Link Amplifier as available on the next frame (apply sells it)', () => {
    const shop = makeShop({ p0: { wallet: 1000 }, p1: { wallet: 1000 } });
    // Frame f: P1 buys Link Amplifier level 1; P2 is soldOut for this frame only.
    shop.update(16);
    expectOk(shop.apply(tx.team(0, 'linkAmp')));
    expect(shop.snapshot().players[1].team.find((t) => t.id === 'linkAmp')!.status).toBe('soldOut');
    // Frame f+1: the same-frame guard is reset.
    shop.update(16);
    const status = shop.snapshot().players[1].team.find((t) => t.id === 'linkAmp')!.status;
    // apply() agrees the item is for sale again (level 2 at 150)...
    const probe = makeShop({ p0: { wallet: 1000 }, p1: { wallet: 1000 } });
    probe.update(16);
    expectOk(probe.apply(tx.team(0, 'linkAmp')));
    probe.update(16);
    expect(probe.apply(tx.team(1, 'linkAmp')).ok).toBe(true);
    // ...but the snapshot (what the UI draws) still says SOLD OUT.
    expect(status).toBe('available');
  });
});

describe('ECON: wallet clamp holds on every path', () => {
  it('undo after gifts refilled the wallet is refused rather than exceed WALLET_MAX', () => {
    const shop = makeShop({ p0: { wallet: ECONOMY.WALLET_MAX - 10 }, p1: { wallet: 1000 } });
    const buy = expectOk(shop.apply(tx.row(0, 'thrusters')));
    // P2 gifts P1 back up to the cap (each gift passes the heldCap check).
    let gifts = 0;
    while (wallet(shop, 0) + 10 <= ECONOMY.WALLET_MAX) {
      expectOk(shop.apply(tx.gift(1)));
      gifts++;
    }
    expect(gifts).toBeGreaterThan(0);
    const before = wallet(shop, 0);
    const r = shop.apply(tx.undo(0));
    expect(r).toMatchObject({ ok: false, reason: 'heldCap' });
    expect(wallet(shop, 0)).toBe(before);
    expect(wallet(shop, 0)).toBeLessThanOrEqual(ECONOMY.WALLET_MAX);
    expect(buy.price).toBeGreaterThan(0);
    // Once P2 takes gifts back and the refund fits, the purchase is refunded exactly.
    while (wallet(shop, 0) + buy.price > ECONOMY.WALLET_MAX) expectOk(shop.apply(tx.undo(1)));
    const room = wallet(shop, 0);
    expectOk(shop.apply(tx.undo(0)));
    expect(wallet(shop, 0)).toBe(room + buy.price);
    expect(wallet(shop, 0)).toBeLessThanOrEqual(ECONOMY.WALLET_MAX);
  });
});

describe('solo shop: no dead team purchases', () => {
  it('offers only the Spare Kernel in solo (no link beam, no partner to revive); co-op keeps all four', () => {
    const solo = makeShop({ mode: 'solo', p0: { wallet: 1000 } });
    solo.update(16);
    expect(solo.snapshot().players[0].team.map((t) => t.id)).toEqual(['spareKernel']);
    const coop = makeShop({ p0: { wallet: 1000 }, p1: { wallet: 1000 } });
    coop.update(16);
    expect(coop.snapshot().players[0].team.map((t) => t.id)).toEqual([
      'spareKernel',
      'linkAmp',
      'linkRange',
      'reviveProtocol',
    ]);
  });
});
