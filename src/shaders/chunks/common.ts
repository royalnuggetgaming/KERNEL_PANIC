/**
 * GLSL ES 3.0 common chunk: constants, hash functions, time helpers, the shared uniform block (names match
 * render/assetTypes.ts SharedUniforms; see shaders/uniformNames.ts) and the tint palette lookup.
 * Every shader includes it once per stage via template literal (never THREE.ShaderChunk).
 */

/** Shared uniforms (by reference on every material). Declared once here, never again in a shader body. */
export const GLSL_SHARED_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform float uSimTime;
uniform float uBeat;
uniform vec3 uPalette[7];
uniform vec3 uP1Color;
uniform vec3 uP2Color;
uniform vec3 uEnemyShotColor;
uniform vec4 uRipples[8];
uniform vec3 uPlayerPos[2];
uniform vec4 uFog;
uniform vec2 uResolution;
uniform float uMinEmissive;
uniform sampler2D uNoiseTex;
uniform float uReduceFlashes;
`;

export const GLSL_COMMON = /* glsl */ `
precision highp float;
precision highp int;
${GLSL_SHARED_UNIFORMS}
#define KP_PI 3.14159265359
#define KP_TAU 6.28318530718

// Palette slots of uPalette (theme SectorPalette order).
#define PAL_FLOOR 0
#define PAL_GRID 1
#define PAL_ACCENT 2
#define PAL_SKY 3
#define PAL_FOG 4
#define PAL_ENEMY 5
#define PAL_ELITE 6

float kpSaturate(float x) { return clamp(x, 0.0, 1.0); }

float kpHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float kpHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 kpHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float kpHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 kpHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// Wraps a (possibly large) time value into [0, period) to keep trig arguments precise.
float kpWrapTime(float t, float period) { return mod(t, period); }

mat2 kpRot2(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, s, -s, c);
}

float kpLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Beat envelope: 1 on the beat, decaying over the bar fraction.
float kpBeatPulse() { return exp(-uBeat * 7.0); }

// Tint slots (shaders/tints.ts TINT). Per-material uniforms uPickupColor/uLinkColor come from the theme.
uniform vec3 uPickupColor;
uniform vec3 uLinkColor;
vec3 kpTintColor(float slot) {
  int i = int(slot + 0.5);
  if (i == 0) return uP1Color;
  if (i == 1) return uP2Color;
  if (i == 2) return uPalette[PAL_ENEMY];
  if (i == 3) return uPalette[PAL_ELITE];
  if (i == 4) return uPickupColor;
  if (i == 5) return uPalette[PAL_ACCENT];
  if (i == 6) return uEnemyShotColor;
  if (i == 7) return uLinkColor;
  if (i == 9) return uPalette[PAL_GRID];
  return vec3(1.0);
}
`;
