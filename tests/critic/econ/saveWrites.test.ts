/**
 * ECON critic reproductions (FAIL on current code), plan section 6 "Writes"/"Failure handling":
 * 1. "Never while Playing, because localStorage is synchronous": a setting changed in Pause is flushed by
 *    SaveStore.tick() 500 ms later regardless of inRun(), i.e. typically after the player resumed (Game.ts
 *    calls save.tick every frame; nothing flushes on Pause exit).
 * 2. "QuotaExceeded: ... keep the in-memory state and show a toast": a quota failure on the Boot write or on
 *    a debounced settings/bindings flush is only logged; status stays 'ok', so BootState shows no toast and
 *    the settings panel never learns the change was not persisted.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../../../src/core/logger';
import { createSaveStore, SAVE_DEBOUNCE_MS, type SaveStore } from '../../../src/save/SaveStore';
import { createKeyValueStorage } from '../../../src/save/storage';
import { FakeClock } from '../../helpers/fakeClock';
import { MemoryStorage } from '../../helpers/memoryStorage';

function harness(mem = new MemoryStorage()): {
  mem: MemoryStorage;
  clock: FakeClock;
  store: SaveStore;
  run: { v: boolean };
} {
  const { kv, memoryOnly } = createKeyValueStorage(mem);
  const clock = new FakeClock(1000);
  const run = { v: false };
  const store = createSaveStore({
    storage: kv,
    memoryOnly,
    clock,
    log: createMemoryLogger(),
    inRun: () => run.v,
  });
  return { mem, clock, store, run };
}

describe('ECON: debounced save writes', () => {
  it('a pending settings write is not flushed to localStorage by the frame tick while a run is live', () => {
    const h = harness();
    h.store.load();
    // Pause -> Settings: change the volume, then resume within the debounce window.
    h.run.v = true;
    h.store.commitDebounced({ settings: { master: 0.3 } });
    h.mem.writes.length = 0;
    h.clock.advance(SAVE_DEBOUNCE_MS + 16);
    h.store.tick(h.clock.now()); // PlayingState frame
    // Observed: 2 synchronous localStorage writes (.bak + main) during Playing.
    expect(h.mem.writes.length).toBe(0);
  });

  it('a QuotaExceeded boot write is reported (status is not plain ok), so Boot can toast', () => {
    const mem = new MemoryStorage();
    mem.failMode = 'quota';
    const h = harness(mem);
    const res = h.store.load();
    expect(mem.rawGet('linkline.save')).toBeNull(); // nothing could be written
    // Observed: 'ok' -> BootState SAVE_TOASTS.ok === null -> silent.
    expect(res.status).not.toBe('ok');
  });
});
