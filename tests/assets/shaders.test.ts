/**
 * Structural GLSL checks without a GPU: balanced braces, one main per stage, GLSL ES 3.0 style, uniform
 * declarations matching createUniforms() + the shared block, vertex outs matching fragment ins, attribute
 * names matching geometry/instancing/ring layouts, and #if blocks balanced with known defines.
 */
import { describe, expect, it } from 'vitest';
import { BEAM, BEAM_KIND } from '../../src/shaders/beam';
import { GLSL_COMMON, GLSL_SHARED_UNIFORMS } from '../../src/shaders/chunks/common';
import { GLSL_INSTANCING } from '../../src/shaders/chunks/instancing';
import { GLSL_LIGHTING } from '../../src/shaders/chunks/lighting';
import { GLSL_NOISE } from '../../src/shaders/chunks/noise';
import { DECAL } from '../../src/shaders/decal';
import { DIGITS, digitCount, SEVEN_SEGMENT } from '../../src/shaders/digits';
import { THEMES } from '../../src/themes/registry';
import { FLOOR } from '../../src/shaders/floor';
import { FORCE_FIELD } from '../../src/shaders/forceField';
import { MARKER } from '../../src/shaders/marker';
import { NEON_SURFACE } from '../../src/shaders/neonSurface';
import { PARTICLE } from '../../src/shaders/particle';
import { PROJECTILE } from '../../src/shaders/projectile';
import { DIGIT_RECORD, PARTICLE_RECORD, SHOCKWAVE_RECORD } from '../../src/shaders/ringLayouts';
import type { ShaderSource } from '../../src/shaders/shaderSource';
import { SHOCKWAVE } from '../../src/shaders/shockwave';
import { HEX_GLYPHS, packGlyph3x5, SKY } from '../../src/shaders/sky';
import { encodeStyle, TINT } from '../../src/shaders/tints';
import { TRAIL } from '../../src/shaders/trail';
import {
  SHARED_UNIFORM_NAMES,
  THREE_BUILTIN_ATTRIBUTES,
  THREE_BUILTIN_UNIFORMS,
} from '../../src/shaders/uniformNames';

const SOURCES: readonly ShaderSource[] = [
  NEON_SURFACE,
  FLOOR,
  SKY,
  PROJECTILE,
  PARTICLE,
  BEAM,
  DECAL,
  MARKER,
  DIGITS,
  SHOCKWAVE,
  TRAIL,
  FORCE_FIELD,
];

const RING_ATTRS = new Map<string, number>();
for (const layout of [PARTICLE_RECORD, SHOCKWAVE_RECORD, DIGIT_RECORD]) {
  for (const a of layout.attributes) RING_ATTRS.set(a.name, a.size);
}
const KNOWN_ATTRIBUTES = new Set(['aT', 'aS', 'aBary', 'aEmissive', 'aTint', ...RING_ATTRS.keys()]);
/** Theme mode defines (set by assets/materials.ts from the theme). */
const MODE_DEFINE = /^(FLOOR_MODE_|SKY_MODE_)/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function declarations(src: string, qualifier: 'uniform' | 'in' | 'out'): { type: string; name: string }[] {
  const re = new RegExp(
    `^\\s*${qualifier}\\s+(?:highp\\s+|mediump\\s+|lowp\\s+)?(\\w+)\\s+(\\w+)(\\[\\d+\\])?\\s*;`,
    'gm',
  );
  const out: { type: string; name: string }[] = [];
  for (const m of stripComments(src).matchAll(re)) out.push({ type: m[1]! + (m[3] ?? ''), name: m[2]! });
  return out;
}

function balanced(src: string): boolean {
  const s = stripComments(src);
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== pairs[ch]) return false;
    }
  }
  return stack.length === 0;
}

function directives(src: string): { opens: number; closes: number; names: string[] } {
  const s = stripComments(src);
  const opens = (s.match(/^\s*#(if|ifdef|ifndef)\b/gm) ?? []).length;
  const closes = (s.match(/^\s*#endif\b/gm) ?? []).length;
  const names: string[] = [];
  for (const m of s.matchAll(/^\s*#(?:el)?if\s+(?:defined\()?\s*(\w+)/gm)) names.push(m[1]!);
  return { opens, closes, names };
}

describe('GLSL chunks', () => {
  it.each([
    ['common', GLSL_COMMON],
    ['noise', GLSL_NOISE],
    ['lighting', GLSL_LIGHTING],
    ['instancing', GLSL_INSTANCING],
  ])('%s is balanced and has no main', (_n, src) => {
    expect(balanced(src)).toBe(true);
    expect(src).not.toMatch(/void\s+main\s*\(/);
    expect(src).not.toMatch(/#version|ShaderChunk|#include/);
  });

  it('declares exactly the shared uniform names in the shared block', () => {
    const names = declarations(GLSL_SHARED_UNIFORMS, 'uniform').map((d) => d.name);
    expect(names.sort()).toEqual([...SHARED_UNIFORM_NAMES].sort());
    expect(declarations(GLSL_SHARED_UNIFORMS, 'uniform').find((d) => d.name === 'uPalette')?.type).toBe(
      'vec3[7]',
    );
    expect(declarations(GLSL_SHARED_UNIFORMS, 'uniform').find((d) => d.name === 'uRipples')?.type).toBe(
      'vec4[8]',
    );
  });
});

describe.each(SOURCES.map((s) => [s.name, s] as const))('shader %s', (_name, src) => {
  it('is GLSL ES 3.0 style with balanced braces and one main per stage', () => {
    for (const stage of [src.vertex, src.fragment]) {
      expect(balanced(stage)).toBe(true);
      expect(stage.match(/void\s+main\s*\(\s*\)/g)?.length).toBe(1);
      expect(stage).not.toMatch(/#version|gl_FragColor|\btexture2D\b|^\s*(attribute|varying)\s/m);
      expect(stage).not.toMatch(/ShaderChunk|#include/);
      const d = directives(stage);
      expect(d.opens).toBe(d.closes);
      for (const n of d.names) {
        const known = n in src.defines || MODE_DEFINE.test(n);
        expect(known, `#if ${n} must be a declared define`).toBe(true);
      }
    }
    expect(src.vertex).toMatch(/gl_Position\s*=/);
    const outs = declarations(src.fragment, 'out');
    expect(outs).toHaveLength(1);
    expect(outs[0]!.type).toBe('vec4');
  });

  it('declares only uniforms it creates or shares, and creates only what it declares', () => {
    const own = Object.keys(src.createUniforms());
    const declared = new Set<string>();
    for (const stage of [src.vertex, src.fragment]) {
      const names = declarations(stage, 'uniform').map((d) => d.name);
      expect(new Set(names).size, 'no duplicate uniform in a stage').toBe(names.length);
      for (const n of names) declared.add(n);
    }
    const allowed = new Set<string>([...own, ...SHARED_UNIFORM_NAMES]);
    for (const n of declared) expect(allowed.has(n), `uniform ${n} has a value source`).toBe(true);
    for (const n of own) expect(declared.has(n), `created uniform ${n} is declared`).toBe(true);
    for (const n of THREE_BUILTIN_UNIFORMS) expect(declared.has(n), `${n} is three's`).toBe(false);
  });

  it('creates fresh uniform objects per call', () => {
    const a = src.createUniforms();
    const b = src.createUniforms();
    for (const k of Object.keys(a)) expect(a[k]).not.toBe(b[k]);
  });

  it('matches vertex outs with fragment ins and uses known attributes', () => {
    const outs = declarations(src.vertex, 'out');
    const ins = declarations(src.fragment, 'in');
    expect(ins.map((d) => `${d.type} ${d.name}`).sort()).toEqual(
      outs.map((d) => `${d.type} ${d.name}`).sort(),
    );
    const attrs = declarations(src.vertex, 'in');
    expect(new Set(attrs.map((a) => a.name)).size).toBe(attrs.length);
    for (const a of attrs) {
      expect(KNOWN_ATTRIBUTES.has(a.name), `attribute ${a.name}`).toBe(true);
      expect((THREE_BUILTIN_ATTRIBUTES as readonly string[]).includes(a.name)).toBe(false);
      const ringSize = RING_ATTRS.get(a.name);
      if (ringSize !== undefined) expect(a.type).toBe(`vec${String(ringSize)}`);
    }
  });

  it('uses only numeric defines', () => {
    for (const v of Object.values(src.defines)) expect(typeof v).toBe('number');
  });
});

describe('shader helpers', () => {
  it('ring shaders read every attribute of their record layout', () => {
    const cases = [
      [PARTICLE, PARTICLE_RECORD],
      [SHOCKWAVE, SHOCKWAVE_RECORD],
      [DIGITS, DIGIT_RECORD],
    ] as const;
    for (const [src, layout] of cases) {
      const names = declarations(src.vertex, 'in').map((d) => d.name);
      expect(names.sort()).toEqual(layout.attributes.map((a) => a.name).sort());
      let used = 0;
      for (const a of layout.attributes) used += a.size;
      expect(used).toBe(layout.stride);
    }
  });

  it('packs the 16 hex glyphs into distinct 15-bit masks', () => {
    const masks = HEX_GLYPHS.map((g) => packGlyph3x5(g));
    expect(masks).toHaveLength(16);
    expect(new Set(masks).size).toBe(16);
    for (const m of masks) expect(m).toBeLessThan(1 << 15);
    expect(packGlyph3x5(['#..', '...', '...', '...', '..#'])).toBe((1 << 0) | (1 << 14));
    expect(SKY.fragment).toContain(`int[16](${masks.join(', ')})`);
  });

  it('seven-segment table and digit counts', () => {
    expect(SEVEN_SEGMENT[8]).toBe(0x7f);
    expect(SEVEN_SEGMENT[1]).toBe(0x06);
    expect([0, 9, 10, 99, 100, 12345, 999999, 1e7, -5].map(digitCount)).toEqual([1, 1, 2, 2, 3, 5, 6, 6, 1]);
  });

  it('style words decode to kind and tint', () => {
    const w = encodeStyle(BEAM_KIND.LASER, TINT.ENEMY_SHOT);
    expect(Math.floor(w / 16)).toBe(BEAM_KIND.LASER);
    expect(w % 16).toBe(TINT.ENEMY_SHOT);
    for (const v of Object.values(TINT)) expect(v).toBeLessThan(16);
  });
});

describe('theme shader modes (fixed at Boot by compile-time defines)', () => {
  const branch = (src: string, define: string): string => {
    const s = stripComments(src);
    const start = s.search(new RegExp(`#(?:el)?if defined\\(${define}\\)`));
    expect(start, `${define} branch`).toBeGreaterThanOrEqual(0);
    // Depth-aware: nested #ifdef LOW_FX blocks (Chromebook variant) inside a mode branch stay in the branch.
    const lines = s.slice(start).split('\n');
    let depth = 0;
    const out: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (l.startsWith('#if')) depth++;
      else if (/^#endif\b/.test(l)) {
        if (depth === 0) break;
        depth--;
      } else if (/^#(elif|else)\b/.test(l) && depth === 0) break;
      out.push(lines[i]!);
    }
    return out.join('\n');
  };

  it('floor implements GRID, CAUSTICS (animated Voronoi) and LAVA (warped FBM + cracked crust)', () => {
    expect(branch(FLOOR.fragment, 'FLOOR_MODE_GRID')).toContain('kpHex');
    const caustics = branch(FLOOR.fragment, 'FLOOR_MODE_CAUSTICS');
    expect(caustics).toMatch(/kpVoronoi2\([^;]*uTime|kpVoronoi2\([^;]*\bt\b/);
    expect(caustics.match(/kpVoronoi2/g)?.length).toBeGreaterThanOrEqual(2);
    const lava = branch(FLOOR.fragment, 'FLOOR_MODE_LAVA');
    expect(lava).toContain('kpCrack');
    expect(lava.match(/kpFbm2/g)?.length).toBeGreaterThanOrEqual(3);
    expect(lava).toContain('seam');
  });

  it('sky implements ABYSS_RAYS (shafts + marine snow) and CORONA, with NEBULA_GLYPHS as the fallback', () => {
    const abyss = branch(SKY.fragment, 'SKY_MODE_ABYSS_RAYS');
    expect(abyss).toContain('shafts');
    expect(abyss).toContain('kpMarineSnow');
    const corona = branch(SKY.fragment, 'SKY_MODE_CORONA');
    expect(corona).toContain('corona');
    expect(corona).toContain('kpFbm3');
    expect(stripComments(SKY.fragment)).toMatch(/#else[\s\S]*kpGlyphRain\(dir\)[\s\S]*#endif/);
  });

  it('every theme mode has a branch and fog/shimmer stay uniforms (no scene.fog, no runtime recompile)', () => {
    for (const t of Object.values(THEMES)) {
      if (t.shading.floorMode !== 'GRID') branch(FLOOR.fragment, `FLOOR_MODE_${t.shading.floorMode}`);
      if (t.shading.skyMode !== 'NEBULA_GLYPHS') branch(SKY.fragment, `SKY_MODE_${t.shading.skyMode}`);
      expect(t.shading.heatShimmer).toBeGreaterThanOrEqual(0);
    }
    expect(FLOOR.fragment).toContain('kpApplyFog');
    expect(THEMES.abyssalLight.shading.fogDensity).toBeGreaterThan(THEMES.kernelPanic.shading.fogDensity);
    expect(THEMES.emberfall.shading.heatShimmer).toBeGreaterThan(0);
  });
});
