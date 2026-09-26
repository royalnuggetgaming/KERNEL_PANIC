/**
 * Arena floor (FLOOR_MODE_GRID): one plane with an fwidth-antialiased circuit grid (4 u major cells matching
 * the sim grid, 1 u minor traces with via pads), a hex overlay, data-flow pulses along the traces sampled from
 * the 256^2 noise DataTexture, two player light pools (uPlayerPos), 8 shockwave ripples (uRipples ring) that
 * also warp the grid, a beat pulse (uBeat) and an arena-edge falloff. Custom fog via uFog.
 *
 * Theme modes are compile-time defines (FLOOR_MODE_<mode>, fixed at Boot). v1 implements FLOOR_MODE_GRID only;
 * assets/materials.ts rejects unimplemented modes.
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

  vec3 hx = kpHex(p / 2.5);
  float hexLine = 1.0 - smoothstep(0.0, fwidth(hx.x) * 1.5 + 0.015, hx.x);
  float hexPulse = 0.5 + 0.5 * sin(uTime * 1.3 + kpHash12(hx.yz) * KP_TAU);

  col += gridC * (major * (0.9 + 0.6 * beat) + trace * 0.35 + faint + pad * 0.9);
  col += accentC * pulse * 2.2;
  col += accentC * hexLine * (0.05 + 0.08 * hexPulse);
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
  defines: { FLOOR_MODE_GRID: 1 },
  createUniforms(): FloorUniforms {
    return { ...createCommonUniforms(), uArenaRadius: { value: 32 }, uCellSize: { value: 4 } };
  },
};
