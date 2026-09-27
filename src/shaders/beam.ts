/**
 * Beams (one batch): the animated Link Beam, chain-lightning arcs and boss lasers (plus their telegraph).
 * Geometry fx:quad (XY in [-0.5, 0.5]) is stretched between two ground points; lightning jaggedness is drawn
 * inside the quad as an SDF around a noisy centre line, so no subdivision is needed. Additive.
 *
 * Instance record (INSTANCE_LAYOUT's 8 floats): aT = (ax, az, bx, bz); aS = (width u, intensity 0..n,
 * style = encodeStyle(BEAM_KIND.*, tint slot), seed).
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_INSTANCING } from './chunks/instancing';
import { GLSL_LIGHTING } from './chunks/lighting';
import { GLSL_NOISE } from './chunks/noise';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export const BEAM_KIND = { LINK: 0, ARC: 1, LASER: 2, LASER_WARN: 3 } as const;

export type BeamUniforms = CommonUniforms & {
  readonly uHeight: UniformSlot<number>;
};

const VERTEX = /* glsl */ `
${GLSL_COMMON}
uniform float uHeight;
${GLSL_INSTANCING}

out vec2 vUv;
out float vLen;
out float vWidth;
out float vIntensity;
out float vKind;
out float vTint;
out float vSeed;
out vec3 vWorld;

void main() {
  vec2 a = aT.xy;
  vec2 b = aT.zw;
  vec2 ab = b - a;
  float len = length(ab);
  float width = aS.x;
  if (width <= 0.0 || len < 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vLen = 0.0;
    vWidth = 0.0;
    vIntensity = 0.0;
    vKind = 0.0;
    vTint = 0.0;
    vSeed = 0.0;
    vWorld = vec3(0.0);
    return;
  }
  float kind = floor(aS.z / 16.0);
  float tint = mod(aS.z, 16.0);
  vec2 dir = ab / len;
  vec2 perp = vec2(-dir.y, dir.x);
  // Arcs need room for the jagged path; others get a glow margin.
  float extent = kind == 1.0 ? width * 3.5 + 0.6 : width * 2.5;
  float along = position.x + 0.5;
  vec2 xz = a + ab * along + perp * position.y * 2.0 * extent;
  vec4 wp = modelMatrix * vec4(xz.x, uHeight, xz.y, 1.0);
  vUv = vec2(along, position.y * 2.0 * extent);
  vLen = len;
  vWidth = width;
  vIntensity = aS.y;
  vKind = kind;
  vTint = tint;
  vSeed = aS.w;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_LIGHTING}
in vec2 vUv;
in float vLen;
in float vWidth;
in float vIntensity;
in float vKind;
in float vTint;
in float vSeed;
in vec3 vWorld;
out vec4 fragColor;

void main() {
  float s = vUv.x;
  float across = vUv.y;
  int kind = int(vKind + 0.5);
  vec3 tintC = kpTintColor(vTint);
  float endFade = smoothstep(0.0, 0.03, s) * smoothstep(1.0, 0.97, s);
  vec3 col = vec3(0.0);
  float a = 0.0;
  // Derivatives in uniform control flow (kind is constant per instance, but keep fwidth outside branches).
  float aa = fwidth(abs(across)) + 1e-4;
  if (kind == 1) {
    // Chain lightning: noisy centre line re-rolled 24 times a second.
    float t = floor(uTime * 24.0);
    float env = sin(s * KP_PI);
    float off = (kpValueNoise2(vec2(s * vLen * 1.3, t + vSeed * 17.0)) - 0.5) * 1.8
      + (kpValueNoise2(vec2(s * vLen * 4.1, t * 1.7)) - 0.5) * 0.6;
    float d = abs(across - off * env);
    float core = 1.0 - smoothstep(vWidth * 0.25, vWidth * 0.5, d);
    float glow = exp(-d / max(vWidth, 0.05) * 1.6) * 0.6;
    col = tintC * (core * 2.4 + glow) + vec3(1.0) * core * 0.8;
    a = kpSaturate(core + glow);
  } else {
    float d = abs(across);
    float halfW = vWidth * 0.5;
    float body = 1.0 - smoothstep(halfW - aa, halfW + aa, d);
    float glow = exp(-max(d - halfW, 0.0) / max(vWidth, 0.05) * 2.0) * 0.6;
    float core = 1.0 - smoothstep(0.0, halfW * 0.45, d);
    if (kind == 0) {
      // Link: travelling data packets both ways.
      float packets = smoothstep(0.85, 1.0, fract(s * vLen * 0.35 - uTime * 2.2))
        + smoothstep(0.9, 1.0, fract(s * vLen * 0.22 + uTime * 1.6));
      float shimmer = 0.8 + 0.2 * sin(s * vLen * 3.0 - uTime * 9.0);
      col = tintC * (body * 1.4 * shimmer + glow) + vec3(1.0) * (core * 0.6 + packets * body * 1.5);
      a = kpSaturate(body + glow);
    } else if (kind == 2) {
      // Boss laser: hot white core, flickering tint body.
      float flick = 0.85 + 0.15 * kpValueNoise2(vec2(s * vLen * 2.0 - uTime * 30.0, vSeed));
      col = tintC * (body * 2.2 + glow * 1.5) * flick + vec3(2.0) * core;
      a = kpSaturate(body + glow);
    } else {
      // Laser telegraph: thin dashed warning line.
      float dash = step(0.5, fract(s * vLen * 0.8 - uTime * 3.0));
      float thin = 1.0 - smoothstep(0.03, 0.06 + aa, d);
      col = tintC * (thin * dash * 1.5 + glow * 0.3);
      a = kpSaturate(thin * dash + glow * 0.3);
    }
  }
  float m = endFade * vIntensity;
  col = kpFadeFog(col * m, length(vWorld - cameraPosition));
  fragColor = vec4(col, a * m);
}
`;

export const BEAM: ShaderSource<BeamUniforms> = {
  name: 'beam',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: {},
  createUniforms(): BeamUniforms {
    return { ...createCommonUniforms(), uHeight: { value: 0.75 } };
  },
};
