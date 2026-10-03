/** Theme registry and data completeness: every theme fills every name, palette, shading and audio field. */
import { describe, expect, it } from 'vitest';
import { TIMBRES } from '../../src/audio/timbre';
import { SCALES } from '../../src/audio/theory';
import { BOSS_IDS, ENEMY_KINDS, SPECIAL_KINDS, THEME_IDS, VEHICLE_IDS } from '../../src/contracts/ids';
import type { ThemeDef } from '../../src/contracts/theme';
import { DEFAULT_THEME_ID, getTheme, THEMES } from '../../src/themes/registry';

function strings(v: unknown, path: string, out: [string, string][]): void {
  if (typeof v === 'string') out.push([path, v]);
  else if (typeof v === 'object' && v !== null)
    for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
}

describe('theme registry', () => {
  it('registers exactly THEME_IDS, each under its own id, and falls back to KERNEL PANIC', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort());
    for (const id of THEME_IDS) expect(getTheme(id).id).toBe(id);
    expect(getTheme('nope').id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(undefined).id).toBe('kernelPanic');
    expect(getTheme('__proto__').id).toBe('kernelPanic');
  });

  it('titles, currencies and floor/sky modes are distinct across themes', () => {
    const all = Object.values(THEMES);
    for (const key of ['title', 'tagline'] as const)
      expect(new Set(all.map((t) => t[key])).size).toBe(all.length);
    expect(new Set(all.map((t) => t.names.runCurrency)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.names.metaCurrency)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.shading.floorMode)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.shading.skyMode)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.audio.timbre)).size).toBe(all.length);
  });
});

describe.each(Object.values(THEMES).map((t) => [t.id, t] as const))('theme %s', (_id, theme: ThemeDef) => {
  it('names every vehicle, blurb, special, enemy and boss, and no name is blank', () => {
    const n = theme.names;
    expect(Object.keys(n.vehicles).sort()).toEqual([...VEHICLE_IDS].sort());
    expect(Object.keys(n.vehicleBlurbs).sort()).toEqual([...VEHICLE_IDS].sort());
    expect(Object.keys(n.specials).sort()).toEqual([...SPECIAL_KINDS].sort());
    expect(Object.keys(n.enemies).sort()).toEqual([...ENEMY_KINDS].sort());
    expect(Object.keys(n.bosses).sort()).toEqual([...BOSS_IDS].sort());
    const all: [string, string][] = [];
    strings(n, 'names', all);
    strings({ title: theme.title, tagline: theme.tagline }, 'theme', all);
    expect(all.filter(([, v]) => v.trim() === '').map(([p]) => p)).toEqual([]);
    expect(theme.title).toMatch(/^[A-Z ]+$/);
    // The voxel title logo stays short enough for the menu backdrop.
    expect(theme.title.length).toBeLessThanOrEqual(14);
  });

  it('has valid 0xRRGGBB colours, three sectors and sane shading params', () => {
    const colours: number[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'number') colours.push(v);
      else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) walk(x);
    };
    walk(theme.palette);
    expect(colours.length).toBe(7 + 4 + 3 * 7);
    for (const c of colours) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
    const s = theme.shading;
    expect(s.fogDensity).toBeGreaterThan(0);
    expect(s.fogDensity).toBeLessThan(0.03);
    expect(s.minEmissive).toBeGreaterThan(0);
    expect(s.heatShimmer).toBeGreaterThanOrEqual(0);
    expect(s.heatShimmer).toBeLessThanOrEqual(1);
    expect(s.bloomThreshold).toBeGreaterThan(0);
    expect(theme.geometry.edgeWidth).toBeGreaterThan(0);
  });

  it('has a playable audio setup: tempo, scale-consistent progression, timbre preset', () => {
    const a = theme.audio;
    expect(a.bpm).toBeGreaterThanOrEqual(60);
    expect(a.bpm).toBeLessThanOrEqual(140);
    expect(TIMBRES[a.timbre]).toBeDefined();
    const scale = SCALES[a.mode];
    for (const step of a.progression) expect(scale).toContain(((step % 12) + 12) % 12);
    expect(a.sectorKeyShift).toHaveLength(3);
  });
});
