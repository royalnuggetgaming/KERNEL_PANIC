/**
 * ECON critic reproductions (FAIL on current code) for ShopModel edge cases:
 * 1. The same-frame team 'soldOut' leaks into later frames through the snapshot cache: update() resets
 *    frameTeamBuys without bumping the state version, so the partner keeps seeing SOLD OUT for an item that
 *    apply() now sells.
 * 2. Undo can push a wallet above WALLET_MAX (plan: wallet in [0, 9,999,999]): undo refunds
 *    `wallet + pricePaid` unclamped after gifts refilled the wallet.
 */
import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../../src/config/tuning';
import { expectOk, makeShop, tx, wallet } from '../../upgrades/shopFixture';

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
  it('undo after gifts refilled the wallet never exceeds WALLET_MAX', () => {
    const shop = makeShop({ p0: { wallet: ECONOMY.WALLET_MAX - 10 }, p1: { wallet: 1000 } });
    const buy = expectOk(shop.apply(tx.row(0, 'thrusters')));
    // P2 gifts P1 back up to the cap (each gift passes the heldCap check).
    let gifts = 0;
    while (wallet(shop, 0) + 10 <= ECONOMY.WALLET_MAX) {
      expectOk(shop.apply(tx.gift(1)));
      gifts++;
    }
    expect(gifts).toBeGreaterThan(0);
    expectOk(shop.apply(tx.undo(0)));
    // Observed: WALLET_MAX + (price - remainder), e.g. 10,000,019.
    expect(wallet(shop, 0)).toBeLessThanOrEqual(ECONOMY.WALLET_MAX);
    expect(buy.price).toBeGreaterThan(0);
  });
});
