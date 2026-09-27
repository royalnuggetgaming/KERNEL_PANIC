/**
 * Tint slots shared by every instanced shader (aS.z or a style word) and the per-material colour uniforms that
 * GLSL_COMMON's kpTintColor() reads. Pure data: render/ writes these slot numbers into instance records.
 */
import type { UniformSlot } from './shaderSource';

export const TINT = {
  P1: 0,
  P2: 1,
  ENEMY: 2,
  /** Corrupted elites: also switches neonSurface into the RGB-split glitch. */
  ELITE: 3,
  PICKUP: 4,
  ACCENT: 5,
  ENEMY_SHOT: 6,
  LINK: 7,
  WHITE: 8,
  GRID: 9,
} as const;

export type TintSlot = (typeof TINT)[keyof typeof TINT];

/** vec3 uniform storage (three uploads Float32Array uniforms with uniform3fv). */
export type Vec3Uniform = UniformSlot<Float32Array>;

/** Extends Record<string, UniformSlot> so it satisfies ShaderSource's uniform bound. */
export interface CommonUniforms extends Record<string, UniformSlot> {
  /** Theme pickup colour (linear RGB), written by assets/materials.ts. */
  readonly uPickupColor: Vec3Uniform;
  /** Theme link-beam colour (linear RGB), written by assets/materials.ts. */
  readonly uLinkColor: Vec3Uniform;
}

export function vec3Uniform(x: number, y: number, z: number): Vec3Uniform {
  return { value: new Float32Array([x, y, z]) };
}

export function createCommonUniforms(): CommonUniforms {
  return { uPickupColor: vec3Uniform(0.5, 1, 0.6), uLinkColor: vec3Uniform(0.6, 0.5, 1) };
}

/**
 * Packs a style word used by beams, decals and markers: kind * 16 + tint slot (both small integers).
 * Decode in GLSL with floor(w / 16.0) and mod(w, 16.0).
 */
export function encodeStyle(kind: number, tint: number): number {
  return kind * 16 + tint;
}
