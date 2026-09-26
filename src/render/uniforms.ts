/**
 * Uniform access helpers for library-built ShaderMaterials. Post materials (sources owned here) must have every
 * uniform (requireUniform throws at setup, never per frame); surface materials are driven only through uniforms
 * they declare (findUniform returns null otherwise), so views stay robust to shader variants.
 */
import type { IUniform, ShaderMaterial } from 'three';

export function findUniform(mat: ShaderMaterial, name: string): IUniform | null {
  const u = mat.uniforms[name];
  return u === undefined ? null : u;
}

export function requireUniform(mat: ShaderMaterial, name: string): IUniform {
  const u = mat.uniforms[name];
  if (u === undefined) throw new Error(`render: material "${mat.name}" has no uniform "${name}"`);
  return u;
}

/** Numeric uniform write that tolerates a missing uniform. */
export function setNumberUniform(u: IUniform | null, v: number): void {
  if (u !== null) u.value = v;
}
