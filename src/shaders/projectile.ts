/**
 * Projectiles: capsule SDF on a ground-parallel quad (geometry fx:capsule, local x across and y along in
 * [-1, 1]) stretched along velocity. Linear bullets are written once at spawn and extrapolated here with
 * kpExtrapolateLinear(uSimTime); homing shots/missiles are rewritten every frame with speed 0 (no stretch).
 *
 * Instance record (INSTANCE_LAYOUT reused): aT = (spawnX, spawnZ, heading rad, speed u/s);
 * aS = (radius u, spawn sim time s, tint slot, seed). radius <= 0 hides the instance (despawned slot).
 * Additive blending: rgb is pre-scaled, alpha is the coverage mask.
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_INSTANCING } from './chunks/instancing';
import { GLSL_LIGHTING } from './chunks/lighting';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, vec3Uniform, type CommonUniforms, type Vec3Uniform } from './tints';

export type ProjectileUniforms = CommonUniforms & {
  /** Hover height of shots (u). */
  readonly uHeight: UniformSlot<number>;
  /** Velocity stretch: extra half-length per u/s of speed (s). */
  readonly uStretch: UniformSlot<number>;
  /** White-hot core colour of enemy shots (theme enemyShotCore), written by assets/materials.ts. */
  readonly uShotCore: Vec3Uniform;
};

const VERTEX = /* glsl */ `
${GLSL_COMMON}
${GLSL_INSTANCING}
uniform float uHeight;
uniform float uStretch;

out vec2 vLocal;
out float vRadius;
out float vHalf;
out float vTint;
out float vSeed;
out vec3 vWorld;

void main() {
  float radius = kpFlash();
  if (radius <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(0.0);
    vRadius = 0.0;
    vHalf = 0.0;
    vTint = 0.0;
    vSeed = 0.0;
    vWorld = vec3(0.0);
    return;
  }
  float halfLen = radius + min(aT.w * uStretch, 2.5);
  float glowR = radius * 2.6;
  vec2 local = vec2(position.x * glowR, position.y * (halfLen - radius + glowR));
  vec2 c = kpExtrapolateLinear(uSimTime);
  vec2 dir = vec2(sin(aT.z), cos(aT.z));
  vec2 perp = vec2(dir.y, -dir.x);
  vec2 xz = c + perp * local.x + dir * local.y;
  vec4 wp = modelMatrix * vec4(xz.x, uHeight, xz.y, 1.0);
  vLocal = local;
  vRadius = radius;
  vHalf = halfLen - radius;
  vTint = kpTint();
  vSeed = kpSeed();
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_LIGHTING}
uniform vec3 uShotCore;

in vec2 vLocal;
in float vRadius;
in float vHalf;
in float vTint;
in float vSeed;
in vec3 vWorld;
out vec4 fragColor;

void main() {
  vec2 q = vec2(vLocal.x, vLocal.y - clamp(vLocal.y, -vHalf, vHalf));
  float d = length(q) - vRadius;
  float aa = fwidth(d) + 1e-4;
  float body = 1.0 - smoothstep(-aa, aa, d);
  float glow = exp(-max(d, 0.0) * 3.2 / max(vRadius, 0.05)) * 0.55;
  float core = 1.0 - smoothstep(-vRadius * 0.55, -vRadius * 0.2, d);
  vec3 tintC = kpTintColor(vTint);
  bool enemy = abs(vTint - 6.0) < 0.5;
  vec3 coreC = enemy ? uShotCore * 2.2 : vec3(1.6) + tintC * 0.6;
  float flicker = 0.9 + 0.1 * sin(uTime * 40.0 + vSeed * 30.0);
  vec3 col = tintC * (body * 1.8 + glow) * flicker + coreC * core;
  float a = kpSaturate(body + glow);
  col = kpFadeFog(col, length(vWorld - cameraPosition));
  fragColor = vec4(col, a);
}
`;

export const PROJECTILE: ShaderSource<ProjectileUniforms> = {
  name: 'projectile',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: {},
  createUniforms(): ProjectileUniforms {
    return {
      ...createCommonUniforms(),
      uHeight: { value: 0.7 },
      uStretch: { value: 0.022 },
      uShotCore: vec3Uniform(1, 0.82, 0.54),
    };
  },
};
