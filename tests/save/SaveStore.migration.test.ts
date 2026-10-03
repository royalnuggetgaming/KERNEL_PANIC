import { describe, expect, it } from 'vitest';
import v1ValidRaw from '../fixtures/saves/v1-valid.json?raw';
import { CURRENT_SAVE_VERSION, SAVE_KEYS } from '../../src/contracts/save';
import { createMemoryLogger } from '../../src/core/logger';
import { createSaveStore } from '../../src/save/SaveStore';
import { createKeyValueStorage } from '../../src/save/storage';
import { FakeClock } from '../helpers/fakeClock';
import { MemoryStorage } from '../helpers/memoryStorage';

function harness(mem: MemoryStorage): { readonly store: ReturnType<typeof createSaveStore> } {
  const { kv, memoryOnly } = createKeyValueStorage(mem);
  mem.writes.length = 0;
  const store = createSaveStore({
    storage: kv,
    memoryOnly,
    clock: new FakeClock(1000),
    log: createMemoryLogger(),
    inRun: () => false,
  });
  return { store };
}

describe('SaveStore v1 -> v2 load', () => {
  it('migrates a v1 save once: the merged Magnet FW spend (15) is refunded and the v2 envelope written', () => {
    const mem = new MemoryStorage();
    mem.rawSet(SAVE_KEYS.main, v1ValidRaw);
    const r = harness(mem).store.load();
    expect(r.status).toBe('ok');
    expect(r.data.cores).toBe(137 + 15);
    expect(r.data.meta).toEqual({ hullFw: 2, legendaryPool: 1 });
    expect(r.data.cheats).toEqual({ unlocked: [], enabled: [] });
    const env = JSON.parse(mem.rawGet(SAVE_KEYS.main)!) as { v: number };
    expect(env.v).toBe(CURRENT_SAVE_VERSION);
    expect(mem.rawGet(SAVE_KEYS.backup)).toBe(v1ValidRaw);
    // Boot uses this to tell the player why Firmware changed and where the Cores came from.
    expect(r.migratedFrom).toBe(1);
    // The rewritten v2 save loads plainly on the next boot (no second notice).
    const again = harness(mem).store.load();
    expect(again.migratedFrom).toBeUndefined();
    expect(again.data.cores).toBe(137 + 15);
  });
});
