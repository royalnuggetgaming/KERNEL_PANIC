/**
 * Damage numbers: 7-segment SDF digits on a camera-facing quad (geometry fx:quad, XY in [-0.5, 0.5]) from a
 * write-once ring record (shaders/ringLayouts.ts DIGIT_RECORD). The quad widens to the digit count (1-6),
 * rises and fades over life; crits (scale > 1.2) pop in. Rendered on top (depthTest off) with additive blend.
 */
import { GLSL_COMMON } from './chunks/common';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export type DigitsUniforms = CommonUniforms & {
  /** Digit cell height in world units at scale 1. */
  readonly uDigitSize: UniformSlot<number>;
};

/** 7-segment masks for 0-9, bits a(0) b(1) c(2) d(3) e(4) f(5) g(6). */
export const SEVEN_SEGMENT = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f] as const;

/** Number of decimal digits drawn for a value (1-6), mirrors the vertex shader. */
export function digitCount(value: number): number {
  let v = Math.max(0, Math.floor(value + 0.5));
  let n = 1;
  for (let i = 0; i < 5; i++) {
    if (v >= 10) {
      v = Math.floor(v / 10);
      n++;
    }
  }
  return n;
}

const VERTEX = /* glsl */ `
${GLSL_COMMON}
uniform float uDigitSize;
in vec4 aD0;
in vec4 aD1;

out vec2 vCell;
out float vValue;
out float vCount;
out float vFade;
out float vTint;

void main() {
  float life = aD1.y;
  float age = uTime - aD0.w;
  if (life <= 0.0 || age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vCell = vec2(0.0);
    vValue = 0.0;
    vCount = 1.0;
    vFade = 0.0;
    vTint = 0.0;
    return;
  }
  float value = floor(max(aD1.x, 0.0) + 0.5);
  float v = value;
  float count = 1.0;
  for (int i = 0; i < 5; i++) {
    if (v >= 10.0) {
      v = floor(v / 10.0);
      count += 1.0;
    }
  }
  float x = age / life;
  float crit = step(1.2, aD1.w);
  float pop = 1.0 + crit * 0.6 * exp(-age * 14.0);
  float size = uDigitSize * aD1.w * pop;
  vec3 center = aD0.xyz + vec3(0.0, (1.0 - pow(1.0 - x, 2.0)) * 1.6, 0.0);
  vec4 view = viewMatrix * modelMatrix * vec4(center, 1.0);
  view.xy += vec2(position.x * count * 0.62, position.y) * size;
  vCell = vec2((position.x + 0.5) * count, position.y + 0.5);
  vValue = value;
  vCount = count;
  vFade = 1.0 - smoothstep(0.65, 1.0, x);
  vTint = aD1.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
const int KP_SEG[10] = int[10](${SEVEN_SEGMENT.map((m) => String(m)).join(', ')});

in vec2 vCell;
in float vValue;
in float vCount;
in float vFade;
in float vTint;
out vec4 fragColor;

float kpSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  int count = int(vCount + 0.5);
  int idx = int(floor(vCell.x));
  if (idx < 0 || idx >= count) discard;
  int iv = int(vValue + 0.5);
  for (int k = 0; k < 6; k++) {
    if (k >= count - 1 - idx) break;
    iv /= 10;
  }
  int mask = KP_SEG[iv % 10];
  vec2 p = vec2((fract(vCell.x) - 0.5) * 0.62, vCell.y - 0.5);
  const float w = 0.18;
  const float h = 0.36;
  float d = 1e3;
  if ((mask & 1) != 0) d = min(d, kpSeg(p, vec2(-w, h), vec2(w, h)));
  if ((mask & 2) != 0) d = min(d, kpSeg(p, vec2(w, h), vec2(w, 0.0)));
  if ((mask & 4) != 0) d = min(d, kpSeg(p, vec2(w, 0.0), vec2(w, -h)));
  if ((mask & 8) != 0) d = min(d, kpSeg(p, vec2(-w, -h), vec2(w, -h)));
  if ((mask & 16) != 0) d = min(d, kpSeg(p, vec2(-w, -h), vec2(-w, 0.0)));
  if ((mask & 32) != 0) d = min(d, kpSeg(p, vec2(-w, 0.0), vec2(-w, h)));
  if ((mask & 64) != 0) d = min(d, kpSeg(p, vec2(-w, 0.0), vec2(w, 0.0)));
  float aa = 0.02;
  float stroke = 1.0 - smoothstep(0.055 - aa, 0.055 + aa, d);
  float glow = exp(-d * 18.0) * 0.45;
  vec3 tintC = kpTintColor(vTint);
  vec3 col = (tintC * 1.6 + vec3(0.9)) * stroke + tintC * glow;
  float a = kpSaturate(stroke + glow) * vFade;
  fragColor = vec4(col * vFade, a);
}
`;

export const DIGITS: ShaderSource<DigitsUniforms> = {
  name: 'digits',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: {},
  createUniforms(): DigitsUniforms {
    return { ...createCommonUniforms(), uDigitSize: { value: 0.55 } };
  },
};
