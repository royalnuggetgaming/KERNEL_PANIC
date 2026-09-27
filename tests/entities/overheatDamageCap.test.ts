/**
 * ECON-2 regression: the runtime Overheat fire-rate overflow (plan section 6 HARD CAPS: "any excess ratio
 * becomes a damage multiplier") must still respect "damage multiplier <= 4.0". computeStats clamps the
 * overflow-adjusted damageMul; entities/weapons.ts re-clamps after applying Overheat's runtime RATE.mul (it
 * used to fire 5 x 3.018 x 1.4 = 21.13 damage needles).
 * Build (all through the real shop): Specter, Overclock 8 + Payload 8 + Overheat, below 30% HP.
 */
import { describe, expect, it } from 'vitest';
import { NullLogger } from '../../src/core/logger';
import { STAT_CAPS } from '../../src/config/tuning';
import { VEHICLES } from '../../src/config/vehicles';
import { createRunSession } from '../../src/sim/RunSession';
import { clearBoss } from '../../src/sim/worldRecords';
import { createIntents } from '../helpers/scriptedIntents';
import { runConfigFor } from '../sim/runDriver';

describe('weapons: Overheat overflow respects the 4.0 damage cap', () => {
  it('a needle fired below 30% HP never exceeds weapon damage x 4.0', () => {
    const s = createRunSession(runConfigFor('solo', 3, { players: [{ player: 0, vehicle: 'specter' }] }), {
      log: NullLogger,
    });
    const idle = createIntents();
    s.beginNextWave();
    const w = s.state;
    for (let i = 0; i < 2_000 && w.run.phase !== 'combat'; i++) s.tick(idle);
    w.enemies.clear();
    w.director.pending.clear();
    w.director.budgetLeft = 0;
    for (const b of w.bosses) clearBoss(b);
    for (let i = 0; i < 2_000 && !s.flags.waveClearReady; i++) s.tick(idle);
    w.run.wallets[0] = 1_000_000;
    const shop = s.openShop();
    shop.update(400);
    for (let i = 0; i < 8; i++)
      expect(shop.apply({ kind: 'buyRow', player: 0, id: 'overclock' }).ok).toBe(true);
    for (let i = 0; i < 8; i++)
      expect(shop.apply({ kind: 'buyRow', player: 0, id: 'payload' }).ok).toBe(true);
    let bought = false;
    for (let t = 0; t < 400 && !bought; t++) {
      const slot = shop.snapshot().players[0].cards.find((c) => c.id === 'overheat');
      if (slot !== undefined) bought = shop.apply({ kind: 'buyCard', player: 0, slot: slot.slot }).ok;
      else shop.apply({ kind: 'reroll', player: 0 });
    }
    expect(bought).toBe(true);
    shop.commit();
    s.applyShopResults();
    s.beginNextWave();
    // Stats themselves respect the cap (the fire-rate overflow was folded into damageMul and clamped).
    const p = w.players[0];
    expect(p.stats.fireRate).toBe(STAT_CAPS.fireRateMax);
    expect(p.stats.damageMul).toBeLessThanOrEqual(STAT_CAPS.damageMulMax);
    // Below 30% HP: Overheat's +40% goes above the 20/s cap and is converted to damage at runtime.
    p.hp = p.stats.maxHp * 0.2;
    p.invulnUntil = w.time + 100;
    // One idle tick lets stepCardEffects raise the Overheat flag (it runs after stepWeapons).
    s.tick(idle);
    expect(p.cards.overheatActive).toBe(true);
    w.playerShots.clear();
    const fire = createIntents();
    fire[0].fireHeld = true;
    let dmg = 0;
    for (let t = 0; t < 12; t++) {
      s.tick(fire);
      for (let k = 0; k < w.playerShots.count; k++) dmg = Math.max(dmg, w.playerShots.active[k]!.damage);
    }
    const cap = VEHICLES.specter.weapon.damage * STAT_CAPS.damageMulMax;
    expect(dmg).toBeLessThanOrEqual(cap + 1e-9);
  });
});
