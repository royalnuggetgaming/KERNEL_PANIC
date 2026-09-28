/**
 * Shop to sim (stat rows and Firmware): every stat row bought through the REAL RunSession -> ShopModel ->
 * applyShopResults path changes the player's DerivedStats and observable sim behaviour (A/B lab pairs on the
 * same seed, see shopLab.ts), and the Firmware snapshot taken at run start reaches the world and the shop.
 */
import { describe, expect, it } from 'vitest';
import type { MetaLevels } from '../../src/contracts/ids';
import type { PlayerIntent } from '../../src/contracts/input';
import type { WorldState } from '../../src/contracts/world';
import { OVERDRIVE } from '../../src/config/tuning';
import { addOverdrive } from '../../src/entities/overdrive';
import { createIntents } from '../helpers/scriptedIntents';
import { addTestPickup } from '../helpers/worldFixture';
import { buyRowTx, firstVolley, pair, run, session, shotsFired, toFirstShop } from './shopLab';

describe('shop to sim: stat rows bought through RunSession change the sim', () => {
  it('Thrusters: +7% moveSpeed and the craft covers more ground', () => {
    const [a, b] = pair(buyRowTx('thrusters'));
    expect(a.state.players[0].stats.moveSpeed).toBeCloseTo(b.state.players[0].stats.moveSpeed * 1.07, 9);
    const move = (i: PlayerIntent): void => {
      i.moveX = 1;
    };
    run(a, 120, move);
    run(b, 120, move);
    expect(a.state.players[0].x - -4).toBeGreaterThan((b.state.players[0].x - -4) * 1.04);
  });

  it('Plating: +20 max HP and heals by the delta', () => {
    const [a, b] = pair(buyRowTx('plating'));
    expect(a.state.players[0].stats.maxHp).toBe(b.state.players[0].stats.maxHp + 20);
    expect(a.state.players[0].hp).toBe(b.state.players[0].hp + 20);
  });

  it('Overclock: +12% fire rate and more volleys', () => {
    const [a, b] = pair(buyRowTx('overclock', 3));
    expect(a.state.players[0].stats.fireRate).toBeCloseTo(b.state.players[0].stats.fireRate * 1.36, 9);
    expect(shotsFired(a, 600)).toBeGreaterThan(shotsFired(b, 600) * 1.3);
  });

  it('Payload: +15% damage on fired projectiles', () => {
    const [a, b] = pair(buyRowTx('payload'));
    expect(firstVolley(a).damage / firstVolley(b).damage).toBeCloseTo(1.15, 6);
  });

  it('Magnet: +25% pickup radius pulls a pickup the control cannot reach', () => {
    const [a, b] = pair(buyRowTx('magnet'));
    const r = b.state.players[0].stats.magnetRadius;
    expect(a.state.players[0].stats.magnetRadius).toBeCloseTo(r * 1.25, 9);
    for (const s of [a, b]) addTestPickup(s.state, -4 + r * 1.15, 0, 5);
    const wa = a.state.run.wallets[0];
    const wb = b.state.run.wallets[0];
    run(a, 30, () => {});
    run(b, 30, () => {});
    expect(a.state.run.wallets[0] - wa).toBe(5);
    expect(b.state.run.wallets[0] - wb).toBe(0);
  });

  it('Coolant: -12% dash cooldown after a dash', () => {
    const [a, b] = pair(buyRowTx('coolant'));
    const dash = (i: PlayerIntent, _w: WorldState, t: number): void => {
      i.moveX = 1;
      i.dashPressed = t === 0;
    };
    run(a, 2, dash);
    run(b, 2, dash);
    expect(a.state.players[0].dashCooldownLeft).toBeLessThan(b.state.players[0].dashCooldownLeft * 0.9);
  });

  it('Capacitor: +20% special charge per Overdrive gain', () => {
    const [a, b] = pair(buyRowTx('capacitor'));
    for (const s of [a, b]) {
      s.state.players[0].overdrive = 0;
      addOverdrive(s.state, 0, 10);
    }
    expect(a.state.players[0].overdrive).toBeCloseTo(12, 9);
    expect(b.state.players[0].overdrive).toBeCloseTo(10, 9);
  });

  it('Special Tuning: tier II special (bigger radius/duration)', () => {
    const [a, b] = pair(buyRowTx('specialTuning'));
    expect(a.state.players[0].stats.specialTier).toBe(1);
    const radius: number[] = [];
    for (const s of [a, b]) {
      // lab() freezes the world in 'countdown', where specials are now locked (the meter is kept): use 'idle',
      // which the rules leave alone and specials may fire in.
      s.state.run.phase = 'idle';
      s.state.players[0].overdrive = OVERDRIVE.MAX;
      const intents = createIntents();
      intents[0].specialPressed = true;
      s.tick(intents);
      expect(s.state.events.special.count).toBe(1);
      radius.push(s.state.events.special.get(0).duration);
    }
    expect(radius[0]!).toBeGreaterThan(radius[1]!);
  });
});

describe('shop to sim: Firmware snapshot at run start', () => {
  it('Hull FW, Boot Cache, Pre-Charge, Second Boot reach the world; Reroll Cache and Legendary Pool reach the shop', () => {
    const meta: MetaLevels = {
      hullFw: 5,
      bootCache: 4,
      preCharge: 1,
      secondBoot: 1,
      rerollCache: 2,
      legendaryPool: 1,
    };
    const s = session('coop', 9, meta);
    const c = session('coop', 9);
    expect(s.state.players[0].stats.maxHp).toBe(Math.floor(c.state.players[0].stats.maxHp * 1.25));
    expect(s.state.run.wallets[0]).toBe(100);
    expect(s.state.players[0].overdrive).toBe(50);
    expect(s.state.run.spareKernels).toBe(2);
    toFirstShop(s);
    s.state.run.wallets[0] = 1_000_000;
    const shop = s.openShop();
    shop.update(400);
    expect(shop.snapshot().players[0].reroll.freeLeft).toBe(2);
    const w0 = shop.snapshot().players[0].wallet;
    expect(shop.apply({ kind: 'reroll', player: 0 }).ok).toBe(true);
    expect(shop.apply({ kind: 'reroll', player: 0 }).ok).toBe(true);
    expect(shop.snapshot().players[0].wallet).toBe(w0);
    // Legendary cards can show up (and be bought) only with the pool.
    let sawL = false;
    for (let i = 0; i < 300 && !sawL; i++) {
      if (shop.snapshot().players[0].cards.some((k) => k.rarity === 'L')) sawL = true;
      else shop.apply({ kind: 'reroll', player: 0 });
    }
    expect(sawL).toBe(true);
  });
});
