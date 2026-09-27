/**
 * Names of the shared uniforms declared by GLSL_COMMON (chunks/common.ts). Must equal the keys of
 * render/assetTypes.ts SharedUniforms (assets/materials.ts checks this at compile time and tests at runtime).
 */
export const SHARED_UNIFORM_NAMES = [
  'uTime',
  'uSimTime',
  'uBeat',
  'uPalette',
  'uP1Color',
  'uP2Color',
  'uEnemyShotColor',
  'uRipples',
  'uPlayerPos',
  'uFog',
  'uResolution',
  'uMinEmissive',
  'uNoiseTex',
  'uReduceFlashes',
] as const;

export type SharedUniformName = (typeof SHARED_UNIFORM_NAMES)[number];

/** Uniforms and attributes three.js declares itself for a GLSL3 ShaderMaterial (never redeclare them). */
export const THREE_BUILTIN_UNIFORMS = [
  'modelMatrix',
  'modelViewMatrix',
  'projectionMatrix',
  'viewMatrix',
  'normalMatrix',
  'cameraPosition',
  'isOrthographic',
] as const;

export const THREE_BUILTIN_ATTRIBUTES = ['position', 'normal', 'uv', 'color'] as const;
