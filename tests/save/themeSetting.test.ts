/** Settings.themeId (v4: three themes): sanitising and the pre-Boot peek used by app/createServices. */
import { describe, expect, it } from 'vitest';
import validRaw from '../fixtures/saves/v2-valid.json?raw';
import { SAVE_KEYS } from '../../src/contracts/save';
import { createMemoryLogger } from '../../src/core/logger';
import { createDefaultSave } from '../../src/save/defaults';
import { encodeEnvelope } from '../../src/save/envelope';
import { safeJsonParse, sanitizeSave } from '../../src/save/sanitize';
import { createSaveStore } from '../../src/save/SaveStore';
import { createKeyValueStorage } from '../../src/save/storage';
import { FakeClock } from '../helpers/fakeClock';
import { MemoryStorage } from '../helpers/memoryStorage';

function v2Data(): Record<string, unknown> {
  return (safeJsonParse(validRaw) as { data: Record<string, unknown> }).data;
}

function store(mem: MemoryStorage) {
  const { kv, memoryOnly } = createKeyValueStorage(mem);
  return createSaveStore({
    storage: kv,
    memoryOnly,
    clock: new FakeClock(1000),
    log: createMemoryLogger(),
    inRun: () => false,
  });
}

describe('Settings.themeId', () => {
  it('keeps every shipped theme and resets unknown ids (old saves) to KERNEL PANIC', () => {
    const data = v2Data();
    const settings = data.settings as Record<string, unknown>;
    expect(settings.themeId).toBe('kernelPanic');
    for (const id of ['kernelPanic', 'abyssalLight', 'emberfall']) {
      const r = sanitizeSave({ ...data, settings: { ...settings, themeId: id } });
      expect(r.data.settings.themeId).toBe(id);
      expect(r.changed).toBe(false);
    }
    for (const bad of ['neonVoid', 7, null, undefined]) {
      const r = sanitizeSave({ ...data, settings: { ...settings, themeId: bad } });
      expect(r.data.settings.themeId).toBe('kernelPanic');
    }
  });

  it('peekThemeId reads main, then backup, then the default, without writing', () => {
    const mem = new MemoryStorage();
    expect(store(mem).peekThemeId()).toBe('kernelPanic');
    const save = createDefaultSave();
    const ember = { ...save, settings: { ...save.settings, themeId: 'emberfall' as const } };
    mem.rawSet(SAVE_KEYS.backup, encodeEnvelope(ember, 1, 0));
    mem.rawSet(SAVE_KEYS.main, 'garbage');
    const s = store(mem);
    const writes = mem.writes.length;
    expect(s.peekThemeId()).toBe('emberfall');
    const abyss = { ...save, settings: { ...save.settings, themeId: 'abyssalLight' as const } };
    mem.rawSet(SAVE_KEYS.main, encodeEnvelope(abyss, 2, 0));
    expect(s.peekThemeId()).toBe('abyssalLight');
    expect(mem.writes.length).toBe(writes);
  });
});
