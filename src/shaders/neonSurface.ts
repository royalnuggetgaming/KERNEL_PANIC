/**
 * neonSurface: the single surface shader for hulls, enemies, bosses, pickups, pylons and the voxel title.
 * Barycentric edge glow (fwidth-antialiased), fresnel rim, vertex-colour albedo under the fixed key light,
 * per-vertex emissive mask (aEmissive), noise-threshold spawn/death dissolve, hit flash and the corrupted
 * RGB-split glitch (tint slot ELITE, or uGlitch on non-instanced meshes).
 *
 * Defines (fixed at Boot): INSTANCED (0/1, reads aT/aS via GLSL_INSTANCING), SPIN (0/1, pickups spin and bob),
 * EMISSIVE_MASK_EDGES (0/1, theme emissiveMask === 'edges'), LOW_FX (present only when on, Chromebook quality: the dissolve noise
 * is only evaluated while dissolving and the corrupted glitch skips its two extra RGB-split edge evaluations).
 *
 * Instanced record: aT = (x, z, yaw, scale); aS = (flash 0..1, spawnT, tint slot, seed).
 * spawnT >= 0: spawn-in dissolve starting at uTime = spawnT. spawnT < 0: death dissolve that started at
 * uTime = -spawnT (the view writes -deathTime when an enemy starts dying).
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_INSTANCING } from './chunks/instancing';
import { GLSL_LIGHTING } from './chunks/lighting';
import { GLSL_NOISE } from './chunks/noise';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, TINT, type CommonUniforms } from './tints';

export type NeonSurfaceUniforms = CommonUniforms & {
  /** Tint slot for non-instanced meshes (instanced meshes use aS.z). */
  readonly uTintIndex: UniformSlot<number>;
  /** Theme edge width (ThemeGeometry.edgeWidth), in barycentric units. */
  readonly uEdgeWidth: UniformSlot<number>;
  /** Non-instanced hit flash 0..1. */
  readonly uFlash: UniformSlot<number>;
  /** Non-instanced dissolve 0..1 (0 = solid). */
  readonly uDissolve: UniformSlot<number>;
  /** Non-instanced glitch amount 0..1 (boss enrage, corrupted). */
  readonly uGlitch: UniformSlot<number>;
};

const VERTEX = /* glsl */ `
${GLSL_COMMON}
#if INSTANCED
${GLSL_INSTANCING}
#endif
uniform float uTintIndex;
uniform float uEdgeWidth;
uniform float uFlash;
uniform float uDissolve;
uniform float uGlitch;

in vec3 aBary;
in float aEmissive;

out vec3 vBary;
out float vEmissive;
out vec3 vColor;
out vec3 vNormal;
out vec3 vWorld;
out vec3 vLocal;
out float vFlash;
out float vDissolve;
out float vTint;
out float vGlitch;
out float vSeed;

void main() {
  vec3 p = position;
  vec3 n = normal;
  float seed = 0.0;
  float flash = uFlash;
  float dissolve = uDissolve;
  float tint = uTintIndex;
  float glitch = uGlitch;
#if INSTANCED
  seed = kpSeed();
  flash = kpFlash();
  tint = kpTint();
  float st = kpSpawnT();
  if (st >= 0.0) {
    dissolve = 1.0 - kpSaturate((uTime - st) / 0.35);
  } else {
    dissolve = kpSaturate((uTime + st) / 0.45);
  }
  glitch = max(glitch, step(2.5, tint) * step(tint, 3.5));
#endif
#if SPIN
  float spin = uTime * 2.2 + seed * KP_TAU;
  mat2 r = kpRot2(spin);
  p.xz = r * p.xz;
  n.xz = r * n.xz;
  p.y += sin(uTime * 3.1 + seed * 11.0) * 0.12;
#endif
  vLocal = p;
  if (glitch > 0.0) {
    float tq = floor(uTime * 14.0);
    float slice = floor(p.y * 6.0 + kpHash11(seed) * 10.0);
    float roll = kpHash12(vec2(slice, tq + seed * 31.0));
    float kick = step(0.8, roll) * (kpHash11(slice + tq) - 0.5) * 0.9;
    p.x += kick * glitch;
  }
#if INSTANCED
  vec4 wp = modelMatrix * vec4(kpInstanceTransform(p), 1.0);
  vec3 wn = mat3(modelMatrix) * kpInstanceNormal(n);
#else
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 wn = mat3(modelMatrix) * n;
#endif
  vBary = aBary;
  vEmissive = aEmissive;
  vColor = color;
  vNormal = normalize(wn);
  vWorld = wp.xyz;
  vFlash = flash;
  vDissolve = dissolve;
  vTint = tint;
  vGlitch = glitch;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_LIGHTING}
uniform float uTintIndex;
uniform float uEdgeWidth;
uniform float uFlash;
uniform float uDissolve;
uniform float uGlitch;

in vec3 vBary;
in float vEmissive;
in vec3 vColor;
in vec3 vNormal;
in vec3 vWorld;
in vec3 vLocal;
in float vFlash;
in float vDissolve;
in float vTint;
in float vGlitch;
in float vSeed;

out vec4 fragColor;

float kpEdge(vec3 b, vec3 fw) {
#if EMISSIVE_MASK_EDGES
  vec3 e = smoothstep(vec3(0.0), fw * 1.25 + vec3(uEdgeWidth), b);
  return 1.0 - min(min(e.x, e.y), e.z);
#else
  return 0.0;
#endif
}

void main() {
  float cut = vDissolve * 1.02;
#ifdef LOW_FX
  float dn = cut > 0.0 ? kpValueNoise3(vLocal * 3.1 + vec3(vSeed * 7.0)) : 1.0;
#else
  float dn = kpValueNoise3(vLocal * 3.1 + vec3(vSeed * 7.0));
#endif
  if (cut > 0.0 && dn < cut) discard;

  vec3 tintC = kpTintColor(vTint);
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vWorld);
  float light = kpKeyLight(n);
  float fres = kpFresnel(n, v, 3.0);
  vec3 fw = fwidth(vBary);
  float edge = kpEdge(vBary, fw);

  vec3 col = vColor * light * 0.55;
  col += tintC * (edge * 1.8 + fres * 0.8 + vEmissive * 1.4);
  col = kpEmissiveFloor(col, tintC);

  if (cut > 0.0) {
    float burn = 1.0 - smoothstep(0.0, 0.08, dn - cut);
    col += tintC * burn * 3.0;
  }

  if (vGlitch > 0.0) {
    float tq = floor(uTime * 20.0);
    float band = kpHash12(vec2(floor(gl_FragCoord.y / 6.0), tq + vSeed * 13.0));
    float shift = (band - 0.5) * 0.35 * vGlitch;
#ifdef LOW_FX
    vec3 split = vec3(edge) * vec3(1.0 + shift * 4.0, 1.0, 1.0 - shift * 4.0) * 1.6;
#else
    float eR = kpEdge(vBary + vec3(shift, -shift, 0.0), fw);
    float eB = kpEdge(vBary - vec3(shift, -shift, 0.0), fw);
    vec3 split = vec3(eR, edge, eB) * 1.6;
#endif
    col = mix(col, col * vec3(1.2, 0.6, 1.2) + split * tintC.gbr, vGlitch * 0.6);
    float drop = step(0.94, band);
    col = mix(col, vec3(col.b, col.r, col.g) * 1.8, drop * vGlitch);
    col *= 1.0 - 0.35 * step(0.5, fract(gl_FragCoord.y * 0.25)) * vGlitch;
  }

  col = kpHitFlash(col, vFlash);
  col = kpApplyFog(col, length(vWorld - cameraPosition));
  fragColor = vec4(col, 1.0);
}
`;

export const NEON_SURFACE: ShaderSource<NeonSurfaceUniforms> = {
  name: 'neonSurface',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: { INSTANCED: 0, SPIN: 0, EMISSIVE_MASK_EDGES: 1 },
  createUniforms(): NeonSurfaceUniforms {
    return {
      ...createCommonUniforms(),
      uTintIndex: { value: TINT.ACCENT },
      uEdgeWidth: { value: 0.045 },
      uFlash: { value: 0 },
      uDissolve: { value: 0 },
      uGlitch: { value: 0 },
    };
  },
};
