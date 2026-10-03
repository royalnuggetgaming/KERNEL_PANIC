/**
 * LOW_FX (Chromebook quality) shader variant structure: the define is fixed at Boot (only present when on), the
 * active floor/sky/neonSurface source drops the expensive layers (Voronoi searches, extra FBMs, glitch edge
 * re-evaluations) for every theme mode, and the program count does not change.
 */
import { describe, expect, it } from 'vitest';
import { createAssetLibrary } from '../../src/assets/AssetLibrary';
import { SCENE_MATERIAL_KEYS } from '../../src/assets/materials';
import { QUALITY_PRESETS } from '../../src/config/quality';
import { NullLogger } from '../../src/core/logger';
import { FLOOR } from '../../src/shaders/floor';
import { GLSL_NOISE } from '../../src/shaders/chunks/noise';
import { NEON_SURFACE } from '../../src/shaders/neonSurface';
import { SKY } from '../../src/shaders/sky';
import { THEMES } from '../../src/themes/registry';

/** Minimal GLSL preprocessor for #ifdef/#ifndef/#if defined()/#elif defined()/#else/#endif and #if NAME. */
function activeSource(src: string, defined: ReadonlySet<string>): string {
  const out: string[] = [];
  // Each frame: [parentActive, branchTaken, currentActive].
  const stack: [boolean, boolean, boolean][] = [];
  const active = (): boolean => (stack.length === 0 ? true : stack[stack.length - 1]![2]);
  const test = (expr: string): boolean => {
    const d = /defined\((\w+)\)/.exec(expr);
    if (d !== null) return defined.has(d[1]!);
    const name = expr.trim();
    return /^\d+$/.test(name) ? Number(name) !== 0 : defined.has(name);
  };
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^#ifdef\s+(\w+)/.exec(l)) !== null) {
      const on = active() && defined.has(m[1]!);
      stack.push([active(), on, on]);
    } else if ((m = /^#ifndef\s+(\w+)/.exec(l)) !== null) {
      const on = active() && !defined.has(m[1]!);
      stack.push([active(), on, on]);
    } else if ((m = /^#if\s+(.+)$/.exec(l)) !== null) {
      const on = active() && test(m[1]!);
      stack.push([active(), on, on]);
    } else if ((m = /^#elif\s+(.+)$/.exec(l)) !== null) {
      const f = stack[stack.length - 1]!;
      const on = f[0] && !f[1] && test(m[1]!);
      f[2] = on;
      f[1] = f[1] || on;
    } else if (/^#else\b/.test(l)) {
      const f = stack[stack.length - 1]!;
      f[2] = f[0] && !f[1];
      f[1] = true;
    } else if (/^#endif\b/.test(l)) {
      stack.pop();
    } else if (active()) {
      out.push(raw);
    }
  }
  expect(stack.length, 'balanced #if/#endif').toBe(0);
  return out.join('\n');
}

/** main() body only (helper definitions are compiled but never called when unused). */
function mainBody(src: string): string {
  return src.slice(src.indexOf('void main()'));
}

const FLOOR_MODES = ['GRID', 'CAUSTICS', 'LAVA'] as const;
const SKY_MODES = ['NEBULA_GLYPHS', 'ABYSS_RAYS', 'CORONA'] as const;
const count = (s: string, re: RegExp): number => s.match(re)?.length ?? 0;

describe('LOW_FX shader variant (Chromebook quality)', () => {
  it('the noise chunk drops the FBMs to 2 octaves only when LOW_FX is defined', () => {
    const full = activeSource(GLSL_NOISE, new Set());
    const low = activeSource(GLSL_NOISE, new Set(['LOW_FX']));
    expect(full).toContain('#define KP_FBM_OCTAVES 3');
    expect(low).toContain('#define KP_FBM_OCTAVES 2');
    expect(low).toContain('#define KP_FBM_NORM 0.75');
  });

  it.each(FLOOR_MODES)('floor %s: no Voronoi search and fewer FBM calls in LOW_FX', (mode) => {
    const full = mainBody(activeSource(FLOOR.fragment, new Set([`FLOOR_MODE_${mode}`])));
    const low = mainBody(activeSource(FLOOR.fragment, new Set([`FLOOR_MODE_${mode}`, 'LOW_FX'])));
    expect(count(low, /kpVoronoi2\(|kpCrack\(/g)).toBe(0);
    expect(count(low, /kpFbm2\(/g)).toBeLessThanOrEqual(count(full, /kpFbm2\(/g));
    // Gameplay-relevant layers stay: the sim grid line, player pools, ripples and the arena rim.
    for (const keep of ['kpGridLine(p, uCellSize', 'uPlayerPos', 'uRipples', 'uArenaRadius']) {
      expect(low).toContain(keep);
    }
  });

  it('floor CAUSTICS and LAVA keep their Voronoi layers in the full variant', () => {
    const caustics = mainBody(activeSource(FLOOR.fragment, new Set(['FLOOR_MODE_CAUSTICS'])));
    expect(count(caustics, /kpVoronoi2\(/g)).toBe(2);
    const lava = mainBody(activeSource(FLOOR.fragment, new Set(['FLOOR_MODE_LAVA'])));
    expect(count(lava, /kpCrack\(/g)).toBe(1);
    expect(activeSource(FLOOR.fragment, new Set(['FLOOR_MODE_LAVA', 'LOW_FX']))).not.toContain(
      'vec2 kpCrack(',
    );
  });

  it.each(SKY_MODES)('sky %s: no more FBM calls in LOW_FX than in the full variant', (mode) => {
    const defs = mode === 'NEBULA_GLYPHS' ? [] : [`SKY_MODE_${mode}`];
    const full = mainBody(activeSource(SKY.fragment, new Set(defs)));
    const low = mainBody(activeSource(SKY.fragment, new Set([...defs, 'LOW_FX'])));
    const fbm = /kpFbm3\(/g;
    expect(count(low, fbm)).toBeLessThanOrEqual(count(full, fbm));
    // ABYSS_RAYS has a single FBM (now 2 octaves via the noise chunk); the others also drop a whole layer.
    expect(count(low, fbm) < count(full, fbm)).toBe(mode !== 'ABYSS_RAYS');
  });

  it('neonSurface: dissolve noise is conditional and the glitch skips the two extra edge evaluations', () => {
    const full = mainBody(activeSource(NEON_SURFACE.fragment, new Set(['EMISSIVE_MASK_EDGES'])));
    const low = mainBody(activeSource(NEON_SURFACE.fragment, new Set(['EMISSIVE_MASK_EDGES', 'LOW_FX'])));
    expect(count(full, /kpEdge\(/g)).toBe(3);
    expect(count(low, /kpEdge\(/g)).toBe(1);
    expect(low).toMatch(/cut > 0\.0 \? kpValueNoise3/);
  });

  it.each(Object.values(THEMES))(
    'materials carry LOW_FX only on the Chromebook preset, same program set ($id)',
    async (theme) => {
      const keysWith = async (quality: 'high' | 'chromebook'): Promise<string[]> => {
        const lib = createAssetLibrary({
          theme,
          quality: QUALITY_PRESETS[quality],
          log: NullLogger,
          seed: 3,
        });
        await lib.build(() => undefined);
        const keys = SCENE_MATERIAL_KEYS.filter((k) => 'LOW_FX' in lib.getMaterial(k).defines);
        lib.dispose();
        return keys;
      };
      expect(await keysWith('high')).toEqual([]);
      const low = await keysWith('chromebook');
      expect(low).toContain('floor');
      expect(low).toContain('sky');
      expect(low).toContain('enemy');
      expect(low).toContain('hull:0');
      // Every neonSurface/floor/sky material gets it, nothing else: one variant per Boot, no extra programs.
      expect(low.every((k) => /^(hull|boss|pylon|title|enemy|pickup|floor|sky)/.test(k))).toBe(true);
    },
    60_000,
  );
});
