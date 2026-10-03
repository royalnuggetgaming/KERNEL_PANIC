/**
 * Arena floor (FLOOR_MODE_GRID): one plane with an fwidth-antialiased circuit grid (4 u major cells matching
 * the sim grid, 1 u minor traces with via pads), a hex overlay, data-flow pulses along the traces sampled from
 * the 256^2 noise DataTexture, two player light pools (uPlayerPos), 8 shockwave ripples (uRipples ring) that
 * also warp the grid, a beat pulse (uBeat) and an arena-edge falloff. Custom fog via uFog.
 *
 * Theme modes are compile-time defines (FLOOR_MODE_<mode>, fixed at Boot by assets/materials.ts):
 * - GRID (KERNEL PANIC): the circuit grid above.
 * - CAUSTICS (ABYSSAL LIGHT): a dark seabed with sand ripples and two scrolling, domain-warped Voronoi caustic
 *   layers, swept by slow light-shaft bands; the sim grid stays as a faint trace.
 * - LAVA (EMBERFALL): domain-warped FBM lava under a cracked Voronoi crust (F2 - F1 seams glow, hotter where the
 *   flow runs hot), kept dark enough for enemy bullets to read.
 *
 * LOW_FX (Chromebook quality, fixed at Boot): GRID drops the hex overlay; CAUSTICS uses two ridged value-noise
 * layers instead of the domain-warped Voronoi pair; LAVA uses a hex crust instead of the 3x3 Voronoi crack search
 * and one FBM for the heat field. Same palette, same arena read.
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_LIGHTING } from './chunks/lighting';
import { GLSL_NOISE } from './chunks/noise';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export type FloorUniforms = CommonUniforms & {
  /** Arena radius (config ARENA.RADIUS), written by assets/materials.ts. */
  readonly uArenaRadius: UniformSlot<number>;
  /** Major grid cell size in world units (config ARENA.GRID_CELL). */
  readonly uCellSize: UniformSlot<number>;
};

const VERTEX = /* glsl */ `
${GLSL_COMMON}
out vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_LIGHTING}
uniform float uArenaRadius;
uniform float uCellSize;

in vec3 vWorld;
out vec4 fragColor;

#ifndef LOW_FX
// F2 - F1 Voronoi distance (0 on a cell border) and the nearest cell hash, for the lava crust cracks.
vec2 kpCrack(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + kpHash22(n + g) - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = kpHash12(n + g);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}
#endif

// Antialiased grid line mask for cells of size 'cell' (1 on the line).
float kpGridLine(vec2 p, float cell, float width) {
  vec2 q = p / cell;
  vec2 d = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-5));
  float l = min(d.x, d.y);
  return 1.0 - smoothstep(width, width + 1.0, l);
}

void main() {
  vec2 p = vWorld.xz;
  vec3 floorC = uPalette[PAL_FLOOR];
  vec3 gridC = uPalette[PAL_GRID];
  vec3 accentC = uPalette[PAL_ACCENT];

  // Shockwave ripples: radial warp of the grid plus a bright travelling ring.
  vec3 rippleGlow = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 1.6) continue;
    vec2 d = p - r.xy;
    float dist = length(d);
    float radius = age * 18.0;
    float fade = 1.0 - age / 1.6;
    float band = exp(-pow((dist - radius) / 0.7, 2.0));
    p += (dist > 1e-3 ? d / dist : vec2(0.0)) * band * 0.45 * r.w * fade;
    rippleGlow += accentC * band * r.w * fade * 0.9;
  }

  float beat = kpBeatPulse();
  vec3 col = floorC;
  float major = kpGridLine(p, uCellSize, 0.6);
#if defined(FLOOR_MODE_GRID)
  float minorCell = uCellSize * 0.25;
  vec2 cellId = floor(p / minorCell);
  vec2 f = fract(p / minorCell);
  float h = kpHash12(cellId);
  vec2 fw = fwidth(p / minorCell);
  // Circuit traces on some minor cell edges (bottom edge = horizontal, left edge = vertical).
  float traceH = step(0.55, h) * (1.0 - smoothstep(0.5, 1.5, abs(f.y) / max(fw.y, 1e-5)));
  float traceV = step(0.55, fract(h * 7.31)) * (1.0 - smoothstep(0.5, 1.5, abs(f.x) / max(fw.x, 1e-5)));
  float trace = max(traceH, traceV);
  // Via pads on a few trace nodes.
  float pad = step(0.9, h) * (1.0 - smoothstep(0.1, 0.1 + fwidth(length(f)) * 1.5, length(f)));
  float faint = kpGridLine(p, minorCell, 0.3) * 0.12;

  // Data-flow pulses along traces, phase from the noise texture per cell row/column.
  vec4 nz = kpNoiseTex(cellId * (1.0 / 64.0));
  float flowH = fract(p.x / (minorCell * 6.0) - uTime * (0.35 + nz.r * 0.5) + nz.g);
  float flowV = fract(p.y / (minorCell * 6.0) - uTime * (0.35 + nz.b * 0.5) + nz.a);
  float pulse = traceH * smoothstep(0.9, 1.0, flowH) + traceV * smoothstep(0.9, 1.0, flowV);

  col += gridC * (major * (0.9 + 0.6 * beat) + trace * 0.35 + faint + pad * 0.9);
  col += accentC * pulse * 2.2;
#ifndef LOW_FX
  vec3 hx = kpHex(p / 2.5);
  float hexLine = 1.0 - smoothstep(0.0, fwidth(hx.x) * 1.5 + 0.015, hx.x);
  float hexPulse = 0.5 + 0.5 * sin(uTime * 1.3 + kpHash12(hx.yz) * KP_TAU);
  col += accentC * hexLine * (0.05 + 0.08 * hexPulse);
#endif
#elif defined(FLOOR_MODE_CAUSTICS)
  float t = kpWrapTime(uTime, 600.0);
  // Sand ripples and darker silt patches.
  vec2 q = p * 0.38;
#ifdef LOW_FX
  float silt = kpValueNoise2(p * 0.11 + vec2(3.7, 1.9));
  // Two ridged value-noise layers stand in for the Voronoi web (ridges near 1 like large F1).
  float c1 = 1.0 - abs(2.0 * kpValueNoise2(q * 1.6 + vec2(t * 0.09, t * 0.05)) - 1.0);
  float c2 = 1.0 - abs(2.0 * kpValueNoise2(q * 2.2 + vec2(-t * 0.07, t * 0.08) + 3.1) - 1.0);
#else
  float silt = kpFbm2(p * 0.11 + vec2(3.7, 1.9));
  // Two domain-warped Voronoi layers; their cell borders (large F1) form the caustic web.
  q += 0.55 * vec2(kpValueNoise2(q * 0.6 + t * 0.12), kpValueNoise2(q * 0.6 - t * 0.1 + 7.3));
  float c1 = kpVoronoi2(q + vec2(t * 0.09, t * 0.05)).x;
  float c2 = kpVoronoi2(q * 1.43 + vec2(-t * 0.07, t * 0.08) + 3.1).x;
#endif
  float ripple = 0.5 + 0.5 * sin(dot(p, vec2(0.9, 0.35)) + silt * 6.0);
  col *= 0.75 + 0.35 * silt + 0.12 * ripple;
  float caust = smoothstep(0.32, 0.78, c1) * smoothstep(0.25, 0.8, c2);
  caust = caust * caust * 2.0 + smoothstep(0.45, 0.85, c1) * 0.2;
  // Slow light-shaft bands sweeping across the seabed.
  float shaft = 0.45 + 0.55 * smoothstep(0.2, 0.9, sin(p.x * 0.11 + p.y * 0.05 + t * 0.21 + silt * 2.5));
  col += gridC * caust * shaft * (0.34 + 0.1 * beat);
  col += gridC * major * 0.16;
  col += accentC * pow(caust * shaft, 2.0) * 0.12;
#elif defined(FLOOR_MODE_LAVA)
  float t = kpWrapTime(uTime, 600.0);
  // Domain-warped FBM heat field: where the lava runs hot under the crust.
  vec2 q = p * 0.07;
#ifdef LOW_FX
  vec2 w = vec2(kpValueNoise2(q * 2.0 + vec2(0.0, t * 0.03)), kpValueNoise2(q * 2.0 + vec2(5.2, 1.3) - t * 0.025));
  float heat = smoothstep(0.3, 0.75, kpFbm2(q * 1.8 + 2.2 * w + vec2(t * 0.02, -t * 0.015)));
  // Hex crust plates (edge distance as the seam, hashed centre as the plate id).
  vec3 hc = kpHex(p * 0.36 + (w - 0.5) * 1.4);
  vec2 cr = vec2(hc.x * 0.9, kpHash12(hc.yz));
#else
  vec2 w = vec2(kpFbm2(q + vec2(0.0, t * 0.03)), kpFbm2(q + vec2(5.2, 1.3) - vec2(t * 0.025, 0.0)));
  float heat = kpFbm2(q * 1.8 + 2.2 * w + vec2(t * 0.02, -t * 0.015));
  heat = smoothstep(0.3, 0.75, heat);
  // Cracked crust: Voronoi plates with glowing F2 - F1 seams.
  vec2 cr = kpCrack(p * 0.36 + (w - 0.5) * 1.4);
#endif
  float seamW = 0.015 + 0.035 * heat;
  float seam = 1.0 - smoothstep(seamW, seamW + fwidth(cr.x) * 1.5 + 0.02, cr.x);
  float flicker = 0.85 + 0.15 * sin(t * 2.3 + cr.y * 40.0);
  col *= 0.6 + 0.6 * cr.y;
  col += gridC * seam * (0.1 + 0.5 * heat) * flicker;
  // Molten pools where the crust melts through, plus a dim glow under the plates.
  col += gridC * smoothstep(0.85, 1.0, heat) * 0.12 * (0.7 + 0.3 * beat);
  col += gridC * heat * 0.025;
  col += accentC * major * 0.1;
#else
  col += gridC * major;
#endif

  // Player light pools.
  for (int i = 0; i < 2; i++) {
    vec3 pp = uPlayerPos[i];
    if (pp.y <= 0.0) continue;
    vec2 d = vWorld.xz - pp.xz;
    float pool = pp.y * exp(-dot(d, d) / 18.0);
    vec3 pc = i == 0 ? uP1Color : uP2Color;
    col += pc * pool * (0.18 + 0.6 * major);
  }
  col += rippleGlow;

  // Arena edge: warning band and falloff outside the play field.
  float rad = length(vWorld.xz);
  float rim = exp(-pow((rad - uArenaRadius) / 0.5, 2.0));
  col += accentC * rim * (1.2 + 0.8 * beat);
  col *= mix(1.0, 0.25, smoothstep(uArenaRadius, uArenaRadius + 14.0, rad));

  col = kpApplyFog(col, length(vWorld - cameraPosition));
  fragColor = vec4(col, 1.0);
}
`;

export const FLOOR: ShaderSource<FloorUniforms> = {
  name: 'floor',
  vertex: VERTEX,
  fragment: FRAGMENT,
  // The FLOOR_MODE_<mode> define comes from the theme (assets/materials.ts floorDefines); LOW_FX (only when on) from quality.
  defines: {},
  createUniforms(): FloorUniforms {
    return { ...createCommonUniforms(), uArenaRadius: { value: 32 }, uCellSize: { value: 4 } };
  },
};
