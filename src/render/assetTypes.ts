/**
 * Three-typed binding of the generic AssetLibraryApi contract plus the shared uniform block every material
 * references. Wave 0 file: W1-ART implements it (assets/AssetLibrary.ts, assets/materials.ts), W1-RENDER
 * consumes it (render/RenderBridge.ts), so neither imports the other.
 */
import type {
  BufferGeometry,
  Color,
  DataTexture,
  Object3D,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { AssetLibraryApi } from '../contracts/render';
import type { GpuRingBuffer } from './GpuRingBuffer';
import type { InstanceBatch } from './InstanceBatch';

export interface Uniform<T> {
  value: T;
}

/** Uniforms shared by reference across all materials (one object; values updated once per frame). */
export interface SharedUniforms {
  /** Seconds, wrapped to avoid float precision loss. */
  readonly uTime: Uniform<number>;
  /** Sim time (s) used to extrapolate linear bullets (aS.y = spawn time). */
  readonly uSimTime: Uniform<number>;
  /** 0..1 beat phase from the audio clock. */
  readonly uBeat: Uniform<number>;
  /** Current sector palette: floor, grid, accent, sky, fog, enemy, elite. */
  readonly uPalette: Uniform<Color[]>;
  readonly uP1Color: Uniform<Color>;
  readonly uP2Color: Uniform<Color>;
  readonly uEnemyShotColor: Uniform<Color>;
  /** 8 floor ripples: (x, z, startTime, strength). */
  readonly uRipples: Uniform<Vector4[]>;
  /** Player light pools: (x, 0, z) per player, y = intensity. */
  readonly uPlayerPos: Uniform<Vector3[]>;
  /** Fog colour (rgb) + density (w); custom fog, never scene.fog. */
  readonly uFog: Uniform<Vector4>;
  readonly uResolution: Uniform<Vector2>;
  readonly uMinEmissive: Uniform<number>;
  readonly uNoiseTex: Uniform<Texture | null>;
  readonly uReduceFlashes: Uniform<number>;
}

export interface ThreeAssetLibrary extends AssetLibraryApi<
  ShaderMaterial,
  BufferGeometry,
  InstanceBatch,
  GpuRingBuffer
> {
  readonly uniforms: SharedUniforms;
  /** Every DataTexture (ShaderWarmup calls renderer.initTexture on each). */
  readonly textures: readonly DataTexture[];
  /** Scene-graph root holding one object per material x geometry x instancing variant (compileAsync). */
  readonly warmScene: Object3D;
}
