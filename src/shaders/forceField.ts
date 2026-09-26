/**
 * Hex force field: the arena wall band (non-instanced, INSTANCED 0) and shield domes (Firewall, Nanoshield;
 * INSTANCED 1). Hex cells tiled over the geometry uv, a rising scan band, fresnel rim, proximity glow near
 * players, floor ripples and the beat pulse. Additive, double-sided.
 *
 * Shield instance record: aT = (x, z, yaw, radius u); aS = (flash 0..1, spawnT, tint slot, seed).
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_INSTANCING } from './chunks/instancing';
import { GLSL_LIGHTING } from './chunks/lighting';
import { GLSL_NOISE } from './chunks/noise';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, TINT, type CommonUniforms } from './tints';

export type ForceFieldUniforms = CommonUniforms & {
  /** Hex cells per uv unit (x around, y up). */
  readonly uUvScale: UniformSlot<Float32Array>;
  /** Tint slot of the non-instanced wall. */
  readonly uTintIndex: UniformSlot<number>;
  /** Overall intensity multiplier. */
  readonly uIntensity: UniformSlot<number>;
};

const VERTEX = /* glsl */ `
${GLSL_COMMON}
#if INSTANCED
${GLSL_INSTANCING}
#endif
uniform float uTintIndex;

out vec2 vUv;
out vec3 vWorld;
out vec3 vNormal;
out float vFlash;
out float vTint;
out float vAge;

void main() {
  float flash = 0.0;
  float tint = uTintIndex;
  float age = 10.0;
#if INSTANCED
  flash = kpFlash();
  tint = kpTint();
  age = uTime - kpSpawnT();
  float pop = 1.0 + 0.25 * exp(-max(age, 0.0) * 10.0) * step(0.0, age);
  vec3 lp = position * pop;
  vec4 wp = modelMatrix * vec4(kpInstanceTransform(lp), 1.0);
  vec3 wn = mat3(modelMatrix) * kpInstanceNormal(normal);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 wn = mat3(modelMatrix) * normal;
#endif
  vUv = uv;
  vWorld = wp.xyz;
  vNormal = normalize(wn);
  vFlash = flash;
  vTint = tint;
  vAge = age;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_LIGHTING}
uniform vec2 uUvScale;
uniform float uTintIndex;
uniform float uIntensity;

in vec2 vUv;
in vec3 vWorld;
in vec3 vNormal;
in float vFlash;
in float vTint;
in float vAge;
out vec4 fragColor;

void main() {
  vec3 tintC = kpTintColor(vTint);
  vec2 hp = vUv * uUvScale;
  vec3 hx = kpHex(hp);
  float aa = fwidth(hx.x) * 1.5 + 1e-4;
  float line = 1.0 - smoothstep(0.02, 0.02 + aa, hx.x);
  float cellH = kpHash12(hx.yz);
  float cellPulse = 0.5 + 0.5 * sin(uTime * (1.0 + cellH * 2.0) + cellH * KP_TAU);
  float scan = exp(-pow((fract(vUv.y * 0.5 - uTime * 0.25) - 0.5) * 8.0, 2.0));

  // Proximity glow: brighter where players (and ripples) are near.
  float prox = 0.0;
  for (int i = 0; i < 2; i++) {
    vec3 pp = uPlayerPos[i];
    if (pp.y <= 0.0) continue;
    vec2 d = vWorld.xz - pp.xz;
    prox += pp.y * exp(-dot(d, d) / 30.0);
  }
  for (int i = 0; i < 8; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 1.6) continue;
    float dist = length(vWorld.xz - r.xy);
    prox += r.w * (1.0 - age / 1.6) * exp(-pow((dist - age * 18.0) / 1.5, 2.0));
  }

  vec3 v = normalize(cameraPosition - vWorld);
  float fres = kpFresnel(normalize(vNormal), v, 2.0);
  float heightFade = 1.0 - smoothstep(0.55, 1.0, vUv.y);
  float base = smoothstep(0.25, 0.0, vUv.y);
  float m = line * (0.25 + 0.35 * cellPulse + prox * 1.5) + fres * 0.35 + scan * 0.25 + base * 0.8;
  m *= heightFade * (0.85 + 0.3 * kpBeatPulse()) * uIntensity;
  m += kpSaturate(vFlash) * mix(1.0, 0.35, uReduceFlashes) * (0.6 + line);
  float appear = kpSaturate(vAge / 0.15);
  m *= appear;
  vec3 col = kpFadeFog(tintC * m, length(vWorld - cameraPosition));
  fragColor = vec4(col, kpSaturate(m));
}
`;

export const FORCE_FIELD: ShaderSource<ForceFieldUniforms> = {
  name: 'forceField',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: { INSTANCED: 0 },
  createUniforms(): ForceFieldUniforms {
    return {
      ...createCommonUniforms(),
      uUvScale: { value: new Float32Array([96, 2.5]) },
      uTintIndex: { value: TINT.ACCENT },
      uIntensity: { value: 1 },
    };
  },
};
