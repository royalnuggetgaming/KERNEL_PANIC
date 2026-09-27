/**
 * ECON critic reproductions (FAIL on current code): Hangar deltas are computed from the tab's cached
 * save.data (MetaShop.metaBuy/metaUnlock/metaRespec) and SaveStore.commitDelta re-reads the stored value but
 * only re-applies the delta + sanitises it (plan section 6 "Writes": re-read, apply, VALIDATE, write). When
 * another tab changed the save and this tab has not processed the storage event yet (event still queued, or
 * the tab was "in run" which defers reloads), the stale delta:
 * - grants a Firmware level for Cores the stored profile no longer has (cores clamp at 0: currency creation);
 * - refunds a respec twice (currency creation);
 * - charges an unlock twice (currency loss).
 */
import { describe, expect, it } from 'vitest';
import { SAVE_KEYS } from '../../../src/contracts/save';
import { createMemoryLogger } from '../../../src/core/logger';
import { decodeEnvelope } from '../../../src/save/envelope';
import { MIGRATIONS } from '../../../src/save/migrations';
import { createSaveStore, type SaveStore } from '../../../src/save/SaveStore';
import { createKeyValueStorage } from '../../../src/save/storage';
import { metaBuy, metaRespec, metaUnlock } from '../../../src/upgrades/MetaShop';
import { FakeClock } from '../../helpers/fakeClock';
import { MemoryStorage } from '../../helpers/memoryStorage';

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

describe('ECON: Hangar deltas are validated against the re-read save', () => {
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
});
