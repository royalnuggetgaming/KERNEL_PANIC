/**
 * Plan section 6 "Writes"/"Failure handling":
 * 1. "Never while Playing, because localStorage is synchronous": a debounced settings write made in Pause is not
 *    flushed by the frame tick while a run is live; it goes out once the run ends, or on pagehide/hidden
 *    (flush()).
 * 2. "QuotaExceeded: ... keep the in-memory state and show a toast": a failed boot or debounced write sets the
 *    status to 'memoryOnly' (BootState and the settings/controls panels toast it); a later successful write
 *    restores 'ok'.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../../src/core/logger';
import { createSaveStore, SAVE_DEBOUNCE_MS, type SaveStore } from '../../src/save/SaveStore';
import { createKeyValueStorage } from '../../src/save/storage';
import { FakeClock } from '../helpers/fakeClock';
import { MemoryStorage } from '../helpers/memoryStorage';

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

describe('SaveStore: debounced writes and write failures', () => {
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

  it('the deferred write goes out once the run ends, and flush() (pagehide) writes even during a run', () => {
    const h = harness();
    h.store.load();
    h.run.v = true;
    h.store.commitDebounced({ settings: { master: 0.3 } });
    h.clock.advance(SAVE_DEBOUNCE_MS + 16);
    h.store.tick(h.clock.now());
    h.mem.writes.length = 0;
    h.run.v = false;
    h.store.tick(h.clock.now());
    expect(h.mem.writes.length).toBe(2);
    h.run.v = true;
    h.store.commitDebounced({ settings: { music: 0.2 } });
    h.mem.writes.length = 0;
    h.store.flush();
    expect(h.mem.writes.length).toBe(2);
  });

  it('a failed debounced flush reports memoryOnly and a later successful write restores ok', () => {
    const h = harness();
    expect(h.store.load().status).toBe('ok');
    h.mem.failMode = 'quota';
    h.store.commitDebounced({ settings: { master: 0.4 } });
    h.clock.advance(SAVE_DEBOUNCE_MS + 16);
    h.store.tick(h.clock.now());
    expect(h.store.status).toBe('memoryOnly');
    expect(h.store.data.settings.master).toBe(0.4);
    h.mem.failMode = 'none';
    h.store.commitDebounced({ settings: { sfx: 0.5 } });
    h.store.flush();
    expect(h.store.status).toBe('ok');
  });
});
