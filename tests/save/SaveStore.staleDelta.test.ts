/**
 * Plan section 6 "Writes": re-read, apply, VALIDATE, write. Hangar deltas are computed from the tab's cached
 * save.data; when another tab changed the save and this tab has not processed the storage event yet, the
 * stale delta must be refused (deltaConflicts) and the re-read value adopted, instead of creating Cores (a buy
 * paid from Cores that are gone, a double respec refund) or losing them (a double unlock charge).
 */
import { describe, expect, it } from 'vitest';
import { SAVE_KEYS } from '../../src/contracts/save';
import { createMemoryLogger } from '../../src/core/logger';
import { decodeEnvelope } from '../../src/save/envelope';
import { MIGRATIONS } from '../../src/save/migrations';
import { createSaveStore, type SaveStore } from '../../src/save/SaveStore';
import { createKeyValueStorage } from '../../src/save/storage';
import { metaBuy, metaRespec, metaUnlock } from '../../src/upgrades/MetaShop';
import { FakeClock } from '../helpers/fakeClock';
import { MemoryStorage } from '../helpers/memoryStorage';

function tab(mem: MemoryStorage, inRun = false): SaveStore {
  const { kv, memoryOnly } = createKeyValueStorage(mem);
  const store = createSaveStore({
    storage: kv,
    memoryOnly,
    clock: new FakeClock(1000),
    log: createMemoryLogger(),
    inRun: () => inRun,
  });
  store.load();
  return store;
}

function stored(mem: MemoryStorage): { cores: number; meta: Record<string, number>; unlocks: string[] } {
  const d = decodeEnvelope(mem.rawGet(SAVE_KEYS.main), MIGRATIONS);
  if (d.kind !== 'ok') throw new Error(d.kind);
  return { cores: d.data.cores, meta: { ...d.data.meta }, unlocks: [...d.data.unlocks] };
}

/** Two tabs on one storage, both loaded with `cores` Cores (and optional Firmware). */
function twoTabs(cores: number, meta: Record<string, number> = {}, spent: Record<string, number> = {}) {
  const mem = new MemoryStorage();
  const seed = tab(mem);
  expect(seed.commit({ coresDelta: cores, meta, spentDelta: spent }).ok).toBe(true);
  return { mem, a: tab(mem), b: tab(mem) };
}

describe('SaveStore: Hangar deltas are validated against the re-read save', () => {
  it('a stale buy cannot take a Firmware level the stored Cores cannot pay for', () => {
    const { mem, a, b } = twoTabs(150);
    const rb = metaBuy(b.data, 'secondBoot'); // 150
    expect(rb.ok && b.commit(rb.delta).ok).toBe(true);
    // Tab A has not seen B's write yet: its cache still shows 150 Cores.
    const ra = metaBuy(a.data, 'legendaryPool'); // 120
    expect(ra.ok).toBe(true);
    if (ra.ok) a.commit(ra.delta);
    const s = stored(mem);
    // Observed: cores 0 with BOTH secondBoot and legendaryPool (270 Cores of Firmware from 150).
    const owned = (s.meta.secondBoot ?? 0) * 150 + (s.meta.legendaryPool ?? 0) * 120;
    expect(owned + s.cores).toBeLessThanOrEqual(150);
  });

  it('a stale respec does not refund twice', () => {
    const { mem, a, b } = twoTabs(0, { hullFw: 2 }, { hullFw: 55 });
    const rb = metaRespec(b.data);
    expect(rb.ok && b.commit(rb.delta).ok).toBe(true);
    expect(stored(mem).cores).toBe(55);
    const ra = metaRespec(a.data);
    if (ra.ok) a.commit(ra.delta);
    // Observed: 110 (the 55 recorded spend was refunded by both tabs).
    expect(stored(mem).cores).toBe(55);
  });

  it('a stale unlock does not charge twice', () => {
    const { mem, a, b } = twoTabs(200);
    const rb = metaUnlock(b.data, 'specter');
    expect(rb.ok && b.commit(rb.delta).ok).toBe(true);
    const ra = metaUnlock(a.data, 'specter');
    if (ra.ok) a.commit(ra.delta);
    const s = stored(mem);
    expect(s.unlocks).toContain('specter');
    // Observed: 80 (60 charged twice for one unlock).
    expect(s.cores).toBe(140);
  });

  it('a refused stale delta adopts the stored save and notifies listeners', () => {
    const { a, b } = twoTabs(150);
    const rb = metaBuy(b.data, 'secondBoot');
    expect(rb.ok && b.commit(rb.delta).ok).toBe(true);
    let seen = 0;
    a.onExternalChange(() => {
      seen++;
    });
    const ra = metaBuy(a.data, 'legendaryPool');
    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    expect(a.commit(ra.delta)).toEqual({ ok: false, error: 'unavailable' });
    expect(a.status).toBe('ok');
    expect(seen).toBe(1);
    expect(a.data.cores).toBe(0);
    expect(a.data.meta.secondBoot).toBe(1);
    expect(metaBuy(a.data, 'legendaryPool')).toEqual({ ok: false, reason: 'funds' });
  });

  it('a stale buy of the same Firmware level is refused (levels are absolute)', () => {
    const { mem, a, b } = twoTabs(1000);
    const rb = metaBuy(b.data, 'hullFw');
    expect(rb.ok && b.commit(rb.delta).ok).toBe(true);
    const ra = metaBuy(a.data, 'hullFw');
    if (ra.ok) expect(a.commit(ra.delta).ok).toBe(false);
    const s = stored(mem);
    expect(s.meta.hullFw).toBe(1);
    expect(s.cores).toBe(a.data.cores);
    // Re-evaluated on the refreshed cache, the next level goes through.
    const again = metaBuy(a.data, 'hullFw');
    expect(again.ok && a.commit(again.delta).ok).toBe(true);
    expect(stored(mem).meta.hullFw).toBe(2);
  });
});
