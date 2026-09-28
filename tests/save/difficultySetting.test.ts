import { describe, expect, it } from 'vitest';
import validRaw from '../fixtures/saves/v1-valid.json?raw';
import { createDefaultSave, DEFAULT_SETTINGS } from '../../src/save/defaults';
import { safeJsonParse, sanitizeSave } from '../../src/save/sanitize';
import { sanitizeSettings } from '../../src/save/sanitizeParts';

function v1Data(): Record<string, unknown> {
  return (safeJsonParse(validRaw) as { data: Record<string, unknown> }).data;
}

describe('Settings.difficulty', () => {
  it('fresh profiles start on NORMAL', () => {
    expect(DEFAULT_SETTINGS.difficulty).toBe('normal');
    expect(createDefaultSave().settings.difficulty).toBe('normal');
    expect(sanitizeSettings(null).difficulty).toBe('normal');
  });

  it('a v1 save without the key stays unchanged (absent reads as NORMAL)', () => {
    const r = sanitizeSave(v1Data());
    expect(r.changed).toBe(false);
    expect(r.data.settings.difficulty).toBeUndefined();
  });

  it('keeps a valid difficulty and resets an unknown one to NORMAL', () => {
    const data = v1Data();
    const settings = data.settings as Record<string, unknown>;
    const hard = sanitizeSave({ ...data, settings: { ...settings, difficulty: 'hard' } });
    expect(hard.data.settings.difficulty).toBe('hard');
    expect(hard.changed).toBe(false);
    for (const bad of ['insane', 3, null, { x: 1 }]) {
      const r = sanitizeSave({ ...data, settings: { ...settings, difficulty: bad } });
      expect(r.data.settings.difficulty).toBe('normal');
      expect(r.changed).toBe(true);
    }
  });
});
