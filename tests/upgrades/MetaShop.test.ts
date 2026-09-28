import { describe, expect, it } from 'vitest';
import { META_UPGRADE_IDS, type MetaUpgradeId, type VehicleId } from '../../src/contracts/ids';
import type { SaveDataV1 } from '../../src/contracts/save';
import { metaDef } from '../../src/config/metaCatalog';
import {
  isVehicleUnlocked,
  metaBuy,
  metaRespec,
  metaUnlock,
  respecRefund,
} from '../../src/upgrades/MetaShop';
import { applyDelta, createTestSaveData } from '../helpers/fakeSave';

function buyAll(save: SaveDataV1, id: MetaUpgradeId): SaveDataV1 {
  let s = save;
  for (;;) {
    const r = metaBuy(s, id);
    if (!r.ok) return s;
    s = applyDelta(s, r.delta);
  }
}

describe('MetaShop', () => {
  it('buys Firmware level by level at the explicit prices, recording the spend', () => {
    let s = createTestSaveData({ cores: 1000 });
    const r = metaBuy(s, 'hullFw');
    expect(r).toEqual({
      ok: true,
      price: 20,
      delta: { coresDelta: -20, meta: { hullFw: 1 }, spentDelta: { hullFw: 20 } },
    });
    s = buyAll(s, 'hullFw');
    expect(s.meta.hullFw).toBe(5);
    expect(s.firmwareSpent.hullFw).toBe(300);
    expect(s.cores).toBe(700);
    expect(metaBuy(s, 'hullFw')).toEqual({ ok: false, reason: 'maxLevel' });
  });

  it('rejects purchases the profile cannot afford', () => {
    const s = createTestSaveData({ cores: 149 });
    expect(metaBuy(s, 'secondBoot')).toEqual({ ok: false, reason: 'funds' });
    expect(metaBuy({ ...s, cores: Number.NaN }, 'hullFw')).toEqual({ ok: false, reason: 'funds' });
    expect(metaBuy(s, 'bogus' as MetaUpgradeId)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('maxing every Firmware line costs about 1,200 Cores (v3: 6 lines, was 9 lines / ~1,660)', () => {
    let total = 0;
    for (const id of META_UPGRADE_IDS) for (const p of metaDef(id).prices) total += p;
    expect(total).toBeGreaterThanOrEqual(1100);
    expect(total).toBeLessThanOrEqual(1300);
  });

  it('respec refunds the recorded spend (not current prices) and keeps unlocks', () => {
    let s = createTestSaveData({ cores: 2000 });
    s = buyAll(s, 'overclockFw');
    const unlock = metaUnlock(s, 'specter');
    if (!unlock.ok) throw new Error(unlock.reason);
    s = applyDelta(s, unlock.delta);
    // A discounted historical purchase: the record, not the price list, is refunded.
    s = { ...s, firmwareSpent: { ...s.firmwareSpent, overclockFw: 100 } };
    expect(respecRefund(s)).toBe(100);
    const r = metaRespec(s);
    expect(r).toEqual({ ok: true, price: 100, delta: { coresDelta: 100, respec: true } });
    const after = applyDelta(s, r.ok ? r.delta : {});
    expect(after.meta).toEqual({});
    expect(after.firmwareSpent).toEqual({});
    expect(after.unlocks).toContain('specter');
    expect(metaRespec(after)).toEqual({ ok: false, reason: 'nothingToRefund' });
  });

  it('unlocks vehicles once; starters are always unlocked', () => {
    const s = createTestSaveData({ cores: 100 });
    expect(isVehicleUnlocked(s, 'lancer')).toBe(true);
    expect(isVehicleUnlocked(s, 'tinker')).toBe(false);
    expect(metaUnlock(s, 'lancer')).toEqual({ ok: false, reason: 'alreadyUnlocked' });
    const r = metaUnlock(s, 'tinker');
    expect(r).toEqual({ ok: true, price: 90, delta: { coresDelta: -90, unlock: 'tinker' } });
    const after = applyDelta(s, r.ok ? r.delta : {});
    expect(isVehicleUnlocked(after, 'tinker')).toBe(true);
    expect(metaUnlock(after, 'tinker')).toEqual({ ok: false, reason: 'alreadyUnlocked' });
    expect(metaUnlock(after, 'specter')).toEqual({ ok: false, reason: 'funds' });
    expect(metaUnlock(after, 'hovercar' as VehicleId)).toEqual({ ok: false, reason: 'invalid' });
    // Unlock spend is not part of the respec refund.
    expect(respecRefund(after)).toBe(0);
  });
});
