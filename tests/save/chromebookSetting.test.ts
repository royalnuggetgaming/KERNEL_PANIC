/** Settings.quality 'chromebook': sanitising old/new saves, the pre-Boot peek and the first-boot fresh profile. */
import { describe, expect, it } from 'vitest';
import validRaw from '../fixtures/saves/v2-valid.json?raw';
import type { Settings } from '../../src/contracts/save';
import { createMemoryLogger } from '../../src/core/logger';
import { safeJsonParse, sanitizeSave } from '../../src/save/sanitize';
import { createSaveStore } from '../../src/save/SaveStore';
import { createKeyValueStorage } from '../../src/save/storage';
import { buildSettingsVM, LOW_FX_RESTART_NOTE } from '../../src/states/settingsPanel';
import { FakeClock } from '../helpers/fakeClock';
import { TEST_SETTINGS } from '../helpers/fakeSave';
import { MemoryStorage } from '../helpers/memoryStorage';

function v2Data(): Record<string, unknown> {
  return (safeJsonParse(validRaw) as { data: Record<string, unknown> }).data;
}

function store(mem: MemoryStorage, fresh?: () => Partial<Settings> | null) {
  const { kv, memoryOnly } = createKeyValueStorage(mem);
  return createSaveStore({
    storage: kv,
    memoryOnly,
    clock: new FakeClock(1000),
    log: createMemoryLogger(),
    inRun: () => false,
    ...(fresh === undefined ? {} : { freshSettings: fresh }),
  });
}

describe("Settings.quality 'chromebook'", () => {
  it('keeps chromebook and every old level; unknown levels sanitise to high', () => {
    const data = v2Data();
    const settings = data.settings as Record<string, unknown>;
    for (const q of ['low', 'medium', 'high', 'ultra', 'chromebook']) {
      const r = sanitizeSave({ ...data, settings: { ...settings, quality: q } });
      expect(r.data.settings.quality).toBe(q);
    }
    for (const bad of ['potato', 'CHROMEBOOK', 3, null, undefined]) {
      const r = sanitizeSave({ ...data, settings: { ...settings, quality: bad } });
      expect(r.data.settings.quality).toBe('high');
    }
  });

  it('peekQuality is null before the first save and the saved level afterwards (no writes)', () => {
    const mem = new MemoryStorage();
    const s = store(mem);
    mem.writes.length = 0; // the storage probe
    expect(s.peekQuality()).toBeNull();
    expect(mem.writes).toHaveLength(0);
    s.load();
    s.commit({ settings: { quality: 'ultra' } });
    expect(store(mem).peekQuality()).toBe('ultra');
  });

  it('a brand-new profile takes freshSettings (the first-boot Chromebook pick) and saves it', () => {
    const mem = new MemoryStorage();
    let calls = 0;
    const s = store(mem, () => {
      calls++;
      return { quality: 'chromebook' };
    });
    expect(s.load().data.settings.quality).toBe('chromebook');
    expect(calls).toBe(1);
    // Second boot: a save exists, so the hook is not consulted and the choice sticks.
    const again = store(mem, () => {
      calls++;
      return { quality: 'low' };
    });
    expect(again.load().data.settings.quality).toBe('chromebook');
    expect(calls).toBe(1);
  });

  it("never overrides an existing save's quality", () => {
    const mem = new MemoryStorage();
    const first = store(mem);
    first.load();
    first.commit({ settings: { quality: 'medium' } });
    const s = store(mem, () => ({ quality: 'chromebook' }));
    expect(s.load().data.settings.quality).toBe('medium');
  });

  it('Settings shows RESTART TO APPLY while the LOW_FX shader variant differs from the running one', () => {
    const cb = { ...TEST_SETTINGS, quality: 'chromebook' as const };
    const rows = (s: Settings, lowFx: boolean): string[] =>
      buildSettingsVM(s, 0, '', s.themeId, lowFx).rows.map((r) => r.id);
    expect(rows(cb, false)).toContain('applyTheme');
    expect(rows(cb, true)).not.toContain('applyTheme');
    expect(rows({ ...TEST_SETTINGS, quality: 'high' }, true)).toContain('applyTheme');
    expect(rows({ ...TEST_SETTINGS, quality: 'low' }, false)).not.toContain('applyTheme');
    expect(buildSettingsVM(cb, 0, '').rows.find((r) => r.id === 'quality')?.value).toBe('CHROMEBOOK');
    expect(LOW_FX_RESTART_NOTE.length).toBeGreaterThan(0);
  });
});
