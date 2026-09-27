/**
 * The shape every shader module exports (three-free so shaders/ only depends on contracts). assets/materials.ts
 * turns a ShaderSource into a GLSL3 ShaderMaterial; render/PostFX receives post materials from the asset library.
 */

/** Structural uniform (compatible with three's IUniform). */
export interface UniformSlot<T = unknown> {
  value: T;
}

export type ShaderDefines = Readonly<Record<string, string | number | boolean>>;

export interface ShaderSource<U extends Record<string, UniformSlot> = Record<string, UniformSlot>> {
  /** Debug name (material.name). */
  readonly name: string;
  /** GLSL ES 3.0 bodies WITHOUT #version (three adds it for glslVersion GLSL3). */
  readonly vertex: string;
  readonly fragment: string;
  /** Compile-time defines fixed at Boot (e.g. FLOOR_MODE_GRID: 1). */
  readonly defines: ShaderDefines;
  /** Fresh per-material uniforms; shared uniforms (render/assetTypes.ts SharedUniforms) are merged in by reference. */
  createUniforms(): U;
}
