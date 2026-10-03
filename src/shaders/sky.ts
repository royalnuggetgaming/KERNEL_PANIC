/**
 * Sky (SKY_MODE_NEBULA_GLYPHS): inverted sphere drawn at the far plane (xyww) with a 3-octave simplex FBM
 * nebula, hashed-cell stars with twinkle and a falling hex-glyph rain (3x5 hex digits 0-F, bit patterns
 * generated here in TS and injected as a GLSL int array). SKY_MODE_* defines are fixed at Boot:
 * - ABYSS_RAYS (ABYSSAL LIGHT): dark water brightening towards the far surface, additive light shafts fanning
 *   down from above (noise-scrolled), and drifting marine snow.
 * - CORONA (EMBERFALL): dark space with stars and a huge red giant low on the horizon: a hot disc with FBM
 *   granulation and an animated, flame-streaked corona.
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_NOISE } from './chunks/noise';
import type { ShaderSource } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export type SkyUniforms = CommonUniforms;

/** 3x5 hex digit glyphs, rows top to bottom ('#' = lit). */
export const HEX_GLYPHS: readonly (readonly string[])[] = [
  ['###', '#.#', '#.#', '#.#', '###'],
  ['.#.', '##.', '.#.', '.#.', '###'],
  ['##.', '..#', '.#.', '#..', '###'],
  ['##.', '..#', '.#.', '..#', '##.'],
  ['#.#', '#.#', '###', '..#', '..#'],
  ['###', '#..', '##.', '..#', '##.'],
  ['.##', '#..', '###', '#.#', '###'],
  ['###', '..#', '.#.', '.#.', '.#.'],
  ['###', '#.#', '###', '#.#', '###'],
  ['###', '#.#', '###', '..#', '##.'],
  ['.#.', '#.#', '###', '#.#', '#.#'],
  ['##.', '#.#', '##.', '#.#', '##.'],
  ['.##', '#..', '#..', '#..', '.##'],
  ['##.', '#.#', '#.#', '#.#', '##.'],
  ['###', '#..', '##.', '#..', '###'],
  ['###', '#..', '##.', '#..', '#..'],
];

/** Packs a 3x5 glyph into 15 bits: bit (row * 3 + col), row 0 = top, col 0 = left. */
export function packGlyph3x5(rows: readonly string[]): number {
  let bits = 0;
  for (let r = 0; r < 5; r++) {
    const row = rows[r] ?? '';
    for (let c = 0; c < 3; c++) if (row.charAt(c) === '#') bits |= 1 << (r * 3 + c);
  }
  return bits;
}

const GLYPH_ARRAY = `const int KP_GLYPHS[16] = int[16](${HEX_GLYPHS.map((g) => String(packGlyph3x5(g))).join(', ')});`;

const VERTEX = /* glsl */ `
${GLSL_COMMON}
out vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLYPH_ARRAY}
in vec3 vDir;
out vec4 fragColor;

float kpStars(vec3 dir) {
  vec2 uv = vec2(atan(dir.z, dir.x) / KP_TAU + 0.5, acos(clamp(dir.y, -1.0, 1.0)) / KP_PI);
  vec2 g = uv * vec2(180.0, 90.0);
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = kpHash12(cell);
  vec2 o = (kpHash22(cell) - 0.5) * 0.7;
  vec2 d = f - o;
  float star = step(0.9, h) * exp(-dot(d, d) * 90.0);
  float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
  return star * tw * (0.6 + 2.0 * fract(h * 13.7));
}

float kpGlyphRain(vec3 dir) {
  float az = atan(dir.z, dir.x) / KP_TAU + 0.5;
  vec2 g = vec2(az * 110.0, dir.y * 42.0);
  float col = floor(g.x);
  float ch = kpHash11(col * 1.37 + 0.5);
  if (ch < 0.45) return 0.0;
  float speed = 2.5 + ch * 5.0;
  float yy = g.y + uTime * speed + ch * 97.0;
  float row = floor(yy);
  vec2 f = vec2(fract(g.x), fract(yy));
  vec2 q = (f - vec2(0.2, 0.1)) / vec2(0.6, 0.8);
  if (q.x < 0.0 || q.x >= 1.0 || q.y < 0.0 || q.y >= 1.0) return 0.0;
  int gx = int(q.x * 3.0);
  int gy = 4 - int(q.y * 5.0);
  float swap = floor(uTime * (1.0 + ch * 3.0) + kpHash11(row) * 5.0);
  int glyph = int(kpHash12(vec2(col, row + swap * 17.0)) * 16.0) & 15;
  int bit = (KP_GLYPHS[glyph] >> (gy * 3 + gx)) & 1;
  float trail = fract(yy / 22.0 + ch);
  float head = pow(trail, 5.0) + step(0.97, trail) * 1.5;
  return float(bit) * head;
}

float kpMarineSnow(vec3 dir, float t) {
  float az = atan(dir.z, dir.x) / KP_TAU + 0.5;
  vec2 g = vec2(az * 140.0, dir.y * 55.0 + t * 0.9);
  vec2 cell = floor(g);
  g.x += sin(t * 0.7 + cell.y * 1.7) * 0.25;
  vec2 f = fract(g) - 0.5;
  float h = kpHash12(cell);
  vec2 d = f - (kpHash22(cell) - 0.5) * 0.6;
  return step(0.82, h) * exp(-dot(d, d) * 140.0) * (0.4 + 0.6 * fract(h * 19.3));
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 skyC = uPalette[PAL_SKY];
  vec3 gridC = uPalette[PAL_GRID];
  vec3 accentC = uPalette[PAL_ACCENT];
  vec3 col;

#if defined(SKY_MODE_ABYSS_RAYS)
  float t = kpWrapTime(uTime, 600.0);
  float up = smoothstep(-0.2, 1.0, dir.y);
  float murk = 0.5 + 0.5 * kpFbm3(dir * 2.6 + vec3(0.0, -t * 0.015, t * 0.01));
  col = skyC * (0.35 + 1.5 * up * up) * (0.7 + 0.5 * murk);
  // Light shafts: azimuthal noise bands that fade in towards the surface.
  float az = atan(dir.z, dir.x);
  float bands = kpValueNoise2(vec2(az * 7.0 + sin(t * 0.05) * 0.8, t * 0.06));
  bands *= kpValueNoise2(vec2(az * 13.0 - t * 0.03, 4.0 + t * 0.045));
  float shafts = pow(bands, 2.0) * smoothstep(-0.15, 0.7, dir.y);
  col += gridC * shafts * 0.9 * (0.85 + 0.15 * kpBeatPulse());
  col += vec3(0.7, 0.86, 1.0) * kpMarineSnow(dir, t) * (0.35 + 0.65 * up);
#elif defined(SKY_MODE_CORONA)
  float t = kpWrapTime(uTime, 600.0);
  col = skyC * 0.55 + vec3(0.85, 0.92, 1.0) * kpStars(dir) * 0.8;
  vec3 sunDir = normalize(vec3(-0.55, 0.18, -0.82));
  float c = dot(dir, sunDir);
  float ang = acos(clamp(c, -1.0, 1.0));
  const float SUN_R = 0.26;
  // Corona flames: FBM along the angle around the star, scrolled outwards over time.
  vec3 side = normalize(cross(sunDir, vec3(0.0, 1.0, 0.0)));
  vec3 upv = cross(side, sunDir);
  float around = atan(dot(dir, upv), dot(dir, side));
  float flame = 0.5 + 0.5 * kpFbm3(vec3(cos(around) * 2.5, sin(around) * 2.5, ang * 6.0 - t * 0.35));
  float reach = SUN_R + 0.05 + 0.22 * flame;
  float corona = exp(-max(ang - SUN_R, 0.0) / (0.05 + 0.12 * flame)) * (1.0 - smoothstep(SUN_R, reach + 0.15, ang));
  col += mix(accentC, gridC, flame) * corona * 1.4;
  col += gridC * exp(-max(ang - SUN_R, 0.0) * 3.0) * 0.35;
  // The disc: granulated FBM surface, hot core, darker limb.
  if (ang < SUN_R) {
    float gran = 0.5 + 0.5 * kpFbm3(dir * 38.0 + vec3(t * 0.05, 0.0, -t * 0.04));
    float limb = sqrt(1.0 - pow(ang / SUN_R, 2.0));
    vec3 hot = mix(gridC, vec3(1.0, 0.62, 0.3), limb * 0.5);
    col = mix(col, hot * (0.6 + 0.6 * gran) * (0.35 + 0.55 * limb), 1.0 - smoothstep(SUN_R - 0.004, SUN_R, ang));
  }
#else
  // SKY_MODE_NEBULA_GLYPHS (KERNEL PANIC), also the fallback.
  float n1 = 0.5 + 0.5 * kpFbm3(dir * 2.2 + vec3(0.0, uTime * 0.012, 0.0));
  float n2 = 0.5 + 0.5 * kpFbm3(dir * 4.1 + vec3(n1 * 1.7, -uTime * 0.02, 3.3));
  col = skyC * (0.6 + 0.8 * n1);
  col += gridC * pow(n1, 3.0) * 0.55;
  col += accentC * pow(n2 * n1, 4.0) * 0.9;

  col += vec3(0.85, 0.92, 1.0) * kpStars(dir);

  float horizon = smoothstep(-0.05, 0.25, dir.y);
  col += accentC * kpGlyphRain(dir) * horizon * 0.8 * (0.7 + 0.3 * kpBeatPulse());
#endif

  float below = smoothstep(0.05, -0.35, dir.y);
  col = mix(col, uFog.rgb, below);
  fragColor = vec4(col, 1.0);
}
`;

export const SKY: ShaderSource<SkyUniforms> = {
  name: 'sky',
  vertex: VERTEX,
  fragment: FRAGMENT,
  // The SKY_MODE_<mode> define comes from the theme (assets/materials.ts skyDefines).
  defines: {},
  createUniforms: createCommonUniforms,
};
