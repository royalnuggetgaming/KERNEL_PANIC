/**
 * Render contracts. Three-free: three-typed internals live in render/ (render/assetTypes.ts binds the
 * generic AssetLibraryApi to three types). FROZEN after Wave 0.
 */
import type { BossId, EnemyKind, PlayerIndex, VehicleId } from './ids';
import type { Settings } from './save';
import type { SimEvents } from './simEvents';
import type { WorldView } from './world';

export type CameraMode = 'attract' | 'select' | 'follow' | 'gameover';

/**
 * Per-instance layout of every InstanceBatch: 8 floats (32 B) per instance, interleaved.
 * aT = (x, z, yaw, scale), aS = (flash, spawnT, tint, seed). Linear bullets reuse the layout:
 * aT.z = heading (rad), aT.w = speed (u/s), aS.y = spawn time (s); see shaders/chunks/instancing.ts.
 */
export const INSTANCE_LAYOUT = { stride: 8, aT: 0, aS: 4 } as const;

export type MaterialKey =
  | 'hull:0'
  | 'hull:1'
  | 'boss'
  | 'enemy'
  | 'floor'
  | 'sky'
  | 'wall'
  | 'pylon'
  | 'pickup'
  | 'projectile'
  | 'particle'
  | 'beam'
  | 'decal'
  | 'marker'
  | 'digits'
  | 'shockwave'
  | 'trail'
  | 'shield'
  | 'title'
  | 'post:blit'
  | 'post:prefilter'
  | 'post:down'
  | 'post:up'
  | 'post:composite';

export type GeometryKey =
  | `vehicle:${VehicleId}`
  | `enemy:${EnemyKind}`
  | `boss:${BossId}`
  | 'arena:floor'
  | 'arena:wall'
  | 'arena:pylon'
  | 'arena:sky'
  | 'pickup'
  | 'shield'
  | 'title'
  | 'fx:quad'
  | 'fx:ring'
  | 'fx:capsule'
  | 'fx:fullscreen'
  | `fx:trail:${PlayerIndex}`;

/** Dense per-frame instance batches. */
export type BatchKey =
  | `enemy:${EnemyKind}`
  | 'playerShots'
  | 'enemyShots'
  | 'missiles'
  | 'pickups'
  | 'decals'
  | 'beams'
  | 'markers'
  | 'shields';

/** Write-once GPU ring buffers (lifetime evaluated in the shader). */
export type RingKey = 'particles' | 'shockwaves' | 'digits';

export interface BatchSet<TBatch, TRing> {
  readonly batches: Readonly<Record<BatchKey, TBatch>>;
  readonly rings: Readonly<Record<RingKey, TRing>>;
}

/**
 * Asset library, generic so this file stays three-free. assets/AssetLibrary.ts implements
 * ThreeAssetLibrary (render/assetTypes.ts) = AssetLibraryApi<ShaderMaterial, BufferGeometry, InstanceBatch, GpuRingBuffer>.
 * Materials and geometries are created once during build(); creation after build throws in DEV.
 */
export interface AssetLibraryApi<TMaterial, TGeometry, TBatch, TRing> {
  /** Incremental across frames; onProgress in [0, 1]. */
  build(onProgress: (p: number) => void): Promise<void>;
  readonly built: boolean;
  getMaterial(key: MaterialKey): TMaterial;
  getGeometry(key: GeometryKey): TGeometry;
  /** Allocates every batch and ring at CAPACITY. Call once (RenderBridge) after build(). */
  createBatches(): BatchSet<TBatch, TRing>;
  dispose(): void;
}

/** What BootState drives (Services.assets). */
export interface AssetLoaderPort {
  build(onProgress: (p: number) => void): Promise<void>;
  /** compileAsync over the warm scene, 2 offscreen PostFX frames, initTexture on every DataTexture. */
  warmup(): Promise<void>;
}

export interface RenderStats {
  readonly calls: number;
  readonly triangles: number;
  readonly programs: number;
  readonly geometries: number;
  readonly textures: number;
  readonly renderScale: number;
  readonly msaa: number;
}

export interface RenderCapabilities {
  readonly webgl2: boolean;
  /** EXT_color_buffer_float: HDR HalfFloat targets; otherwise RGBA8 fallback. */
  readonly floatTargets: boolean;
}

export interface PostParams {
  readonly bloomStrength: number;
  readonly bloomThreshold: number;
  readonly chromatic: number;
  readonly vignette: number;
  readonly grain: number;
  readonly scanlines: number;
  /** 0 = live, 1 = fully dimmed/blurred freeze frame. */
  readonly freeze: number;
  /** 0..1 damage vignette. */
  readonly hurt: number;
}

export type ViewRectSink = (minX: number, maxX: number, minZ: number, maxZ: number) => void;

export interface RenderPort {
  readonly capabilities: RenderCapabilities;
  /** Binds views to a live world; the bridge publishes the camera's ground view rect through setViewRect. */
  attachWorld(w: WorldView, setViewRect: ViewRectSink): void;
  /** Zeroes batch counts and releases the world reference. */
  detachWorld(): void;
  setCameraMode(m: CameraMode): void;
  /** CharacterSelect turntables (null = empty pedestal). */
  showVehiclePreviews(sel: readonly [VehicleId | null, VehicleId | null]): void;
  /** Read-only drain to FxDirector (particles, shockwaves, shake, digits). Does not clear channels. */
  consumeEvents(e: SimEvents): void;
  setSector(s: 1 | 2 | 3): void;
  setBeat(phase: number): void;
  /** Syncs views with interpolation alpha, updates the camera, renders scene + post. */
  frame(alpha: number, frameDt: number): void;
  /** Renders ONE frozen composite frame (dim 0..1) and then the GPU idles until the next frame() call. */
  renderFrozen(dim: number): void;
  /** Quality preset, shake scale, reduce flashes/motion, colourblind palette, FPS counter. */
  applySettings(s: Settings): void;
  stats(): RenderStats;
}
