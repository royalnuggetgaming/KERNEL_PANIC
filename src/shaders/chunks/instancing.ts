/**
 * GLSL ES 3.0 instancing chunk matching INSTANCE_LAYOUT: aT = (x, z, yaw, scale), aS = (flash, spawnT, tint,
 * seed). Compose by template literal (never mutate THREE.ShaderChunk). three prepends `#version 300 es` and
 * declares position/normal/uv/modelMatrix/etc. for ShaderMaterial with glslVersion GLSL3.
 *
 * Yaw convention (core/math.ts): forward(yaw) = (sin yaw, cos yaw) on the ground plane (x, z).
 */
import { INSTANCE_LAYOUT } from '../../contracts/render';

export const INSTANCE_STRIDE = INSTANCE_LAYOUT.stride;

export const GLSL_INSTANCING = /* glsl */ `
in vec4 aT; // x, z, yaw, scale        (float offset ${String(INSTANCE_LAYOUT.aT)})
in vec4 aS; // flash, spawnT, tint, seed (float offset ${String(INSTANCE_LAYOUT.aS)})

// Rotates a local-space vertex by yaw around +Y, scales it and places it at (aT.x, 0, aT.y).
vec3 kpInstanceTransform(vec3 p) {
  float s = sin(aT.z);
  float c = cos(aT.z);
  vec3 q = p * aT.w;
  return vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c) + vec3(aT.x, 0.0, aT.y);
}

// Rotates a local-space direction (normal) by yaw around +Y.
vec3 kpInstanceNormal(vec3 n) {
  float s = sin(aT.z);
  float c = cos(aT.z);
  return vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
}

// Linear bullets: aT.xy = spawn position, aT.z = heading (rad), aT.w = speed (u/s), aS.y = spawn time (s).
// Returns the extrapolated ground position at sim time 'now'.
vec2 kpExtrapolateLinear(float now) {
  float t = max(now - aS.y, 0.0);
  return aT.xy + vec2(sin(aT.z), cos(aT.z)) * aT.w * t;
}

float kpFlash() { return aS.x; }
float kpSpawnT() { return aS.y; }
float kpTint() { return aS.z; }
float kpSeed() { return aS.w; }
`;
