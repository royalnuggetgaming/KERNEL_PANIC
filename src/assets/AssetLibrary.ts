/**
 * ThreeAssetLibrary implementation. build(onProgress) runs incrementally across frames (textures, geometries,
 * materials, warm scene), then freezes the material registry. getMaterial/getGeometry throw before build.
 * createBatches() allocates every InstanceBatch and GpuRingBuffer at capacity (once). The warm scene holds one
 * object per material x geometry x instancing variant (count 1) for ShaderWarmup's compileAsync.
 */
import { Group, Mesh, type BufferGeometry, type DataTexture, type ShaderMaterial } from 'three';
import type { QualityPreset } from '../config/quality';
import { BOSS_IDS, ENEMY_KINDS, type Logger, PLAYER_INDICES, VEHICLE_IDS } from '../contracts/ids';
import type { BatchKey, BatchSet, GeometryKey, MaterialKey, RingKey } from '../contracts/render';
import type { ThemeDef } from '../contracts/theme';
import type { SharedUniforms, ThreeAssetLibrary } from '../render/assetTypes';
import { GpuRingBuffer } from '../render/GpuRingBuffer';
import { InstanceBatch } from '../render/InstanceBatch';
import { BLIT, BLOOM_PREFILTER, KAWASE_DOWN, KAWASE_UP } from '../shaders/post/bloom';
import { COMPOSITE } from '../shaders/post/composite';
import { BATCH_SPECS, MESH_PAIRS, RING_SPECS } from './batchSpecs';
import { buildArena, buildPickupGeometry, buildShieldGeometry } from './geometry/arena';
import { buildBossGeometry } from './geometry/bosses';
import { buildEnemyGeometry } from './geometry/enemies';
import { buildFxShapes, buildTrailGeometry } from './geometry/fxShapes';
import { buildVehicleGeometry } from './geometry/vehicles';
import { buildVoxelText } from './geometry/voxelFont';
import {
  createMaterialRegistry,
  createSharedUniforms,
  POST_MATERIAL_KEYS,
  SCENE_MATERIAL_KEYS,
  type MaterialRegistry,
} from './materials';
import { createNoise } from './noise';
import { createHexMaskTexture, createNoiseTexture, createPaletteRamp } from './textures';

export interface AssetLibraryDeps {
  readonly theme: ThemeDef;
  readonly quality: QualityPreset;
  readonly log: Logger;
  readonly seed: number;
}

/** Resolves on the next animation frame (browser) or macrotask (node/tests). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        resolve();
      });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

type BuildStep = () => void;

class AssetLibrary implements ThreeAssetLibrary {
  readonly uniforms: SharedUniforms;
  readonly warmScene = new Group();
  private readonly deps: AssetLibraryDeps;
  private readonly geometries = new Map<GeometryKey, BufferGeometry>();
  private readonly materials: MaterialRegistry;
  private readonly textureList: DataTexture[] = [];
  private readonly warmBatches: (InstanceBatch | GpuRingBuffer)[] = [];
  private batchSet: BatchSet<InstanceBatch, GpuRingBuffer> | null = null;
  private isBuilt = false;
  private building: Promise<void> | null = null;
  private disposed = false;

  constructor(deps: AssetLibraryDeps) {
    this.deps = deps;
    this.uniforms = createSharedUniforms(deps.theme);
    this.materials = createMaterialRegistry({
      theme: deps.theme,
      shared: this.uniforms,
      log: deps.log,
      post: {
        'post:blit': BLIT,
        'post:prefilter': BLOOM_PREFILTER,
        'post:down': KAWASE_DOWN,
        'post:up': KAWASE_UP,
        'post:composite': COMPOSITE,
      },
    });
    this.warmScene.name = 'warmScene';
  }

  get built(): boolean {
    return this.isBuilt;
  }

  get textures(): readonly DataTexture[] {
    return this.textureList;
  }

  build(onProgress: (p: number) => void): Promise<void> {
    if (this.building !== null) return this.building;
    this.building = this.runBuild(onProgress);
    return this.building;
  }

  getMaterial(key: MaterialKey): ShaderMaterial {
    if (!this.isBuilt) throw new Error(`AssetLibrary.getMaterial('${key}') before build()`);
    return this.materials.get(key);
  }

  getGeometry(key: GeometryKey): BufferGeometry {
    if (!this.isBuilt) throw new Error(`AssetLibrary.getGeometry('${key}') before build()`);
    const g = this.geometries.get(key);
    if (g === undefined) throw new Error(`AssetLibrary: unknown geometry '${key}'`);
    return g;
  }

  createBatches(): BatchSet<InstanceBatch, GpuRingBuffer> {
    if (!this.isBuilt) throw new Error('AssetLibrary.createBatches() before build()');
    if (this.batchSet !== null) throw new Error('AssetLibrary.createBatches() called twice');
    const batches = {} as Record<BatchKey, InstanceBatch>;
    for (const s of BATCH_SPECS) {
      batches[s.key] = new InstanceBatch(
        this.getGeometry(s.geometry),
        this.getMaterial(s.material),
        s.capacity,
        `batch:${s.key}`,
      );
    }
    const rings = {} as Record<RingKey, GpuRingBuffer>;
    for (const s of RING_SPECS) {
      rings[s.key] = new GpuRingBuffer(
        this.getGeometry(s.geometry),
        this.getMaterial(s.material),
        s.capacity,
        s.layout.stride,
        s.layout.attributes,
        `ring:${s.key}`,
      );
    }
    this.batchSet = { batches, rings };
    return this.batchSet;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.batchSet !== null) {
      for (const b of Object.values(this.batchSet.batches)) b.dispose();
      for (const r of Object.values(this.batchSet.rings)) r.dispose();
      this.batchSet = null;
    }
    for (const w of this.warmBatches) w.dispose();
    this.warmBatches.length = 0;
    this.warmScene.clear();
    for (const g of this.geometries.values()) g.dispose();
    this.geometries.clear();
    this.materials.dispose();
    for (const t of this.textureList) t.dispose();
    this.textureList.length = 0;
    this.uniforms.uNoiseTex.value = null;
    this.isBuilt = false;
  }

  private async runBuild(onProgress: (p: number) => void): Promise<void> {
    const steps = this.buildSteps();
    onProgress(0);
    for (let i = 0; i < steps.length; i++) {
      if (this.disposed) throw new Error('AssetLibrary disposed during build()');
      steps[i]!();
      onProgress((i + 1) / (steps.length + 1));
      await nextFrame();
    }
    this.materials.freeze();
    this.isBuilt = true;
    this.buildWarmScene();
    this.deps.log.info('assets built', {
      geometries: this.geometries.size,
      materials: this.materials.all().length,
      textures: this.textureList.length,
      warmObjects: this.warmScene.children.length,
    });
    onProgress(1);
  }

  private buildSteps(): BuildStep[] {
    const { theme, seed } = this.deps;
    const steps: BuildStep[] = [];
    steps.push(() => {
      const noise = createNoise(seed);
      const noiseTex = createNoiseTexture(noise);
      this.textureList.push(noiseTex, createHexMaskTexture(noise), createPaletteRamp(theme));
      this.uniforms.uNoiseTex.value = noiseTex;
    });
    steps.push(() => {
      for (const v of VEHICLE_IDS) this.addGeometry(`vehicle:${v}`, buildVehicleGeometry(v, theme));
    });
    steps.push(() => {
      for (const k of ENEMY_KINDS) this.addGeometry(`enemy:${k}`, buildEnemyGeometry(k, theme));
    });
    steps.push(() => {
      for (const b of BOSS_IDS) this.addGeometry(`boss:${b}`, buildBossGeometry(b, theme));
    });
    steps.push(() => {
      const arena = buildArena(theme);
      this.addGeometry('arena:floor', arena.floor);
      this.addGeometry('arena:wall', arena.wall);
      this.addGeometry('arena:pylon', arena.pylon);
      this.addGeometry('arena:sky', arena.sky);
      this.addGeometry('pickup', buildPickupGeometry());
      this.addGeometry('shield', buildShieldGeometry());
      this.addGeometry('title', buildVoxelText(theme.title));
      const fx = buildFxShapes();
      this.addGeometry('fx:quad', fx.quad);
      this.addGeometry('fx:ring', fx.ring);
      this.addGeometry('fx:capsule', fx.capsule);
      this.addGeometry('fx:fullscreen', fx.fullscreen);
      for (const p of PLAYER_INDICES) this.addGeometry(`fx:trail:${p}`, buildTrailGeometry(p));
    });
    steps.push(() => {
      for (const k of SCENE_MATERIAL_KEYS) this.materials.create(k);
      for (const k of POST_MATERIAL_KEYS) this.materials.create(k);
    });
    return steps;
  }

  private addGeometry(key: GeometryKey, g: BufferGeometry): void {
    if (this.geometries.has(key)) throw new Error(`AssetLibrary: duplicate geometry '${key}'`);
    this.geometries.set(key, g);
  }

  /** One object per material x geometry x instancing variant, each with exactly one live instance. */
  private buildWarmScene(): void {
    for (const s of BATCH_SPECS) {
      const b = new InstanceBatch(this.getGeometry(s.geometry), this.getMaterial(s.material), 1, `warm:${s.key}`);
      b.begin();
      b.push(0, 0, 0, 1, 0, 0, 0, 0);
      b.commit();
      this.warmBatches.push(b);
      this.warmScene.add(b.mesh);
    }
    for (const s of RING_SPECS) {
      const r = new GpuRingBuffer(
        this.getGeometry(s.geometry),
        this.getMaterial(s.material),
        1,
        s.layout.stride,
        s.layout.attributes,
        `warm:${s.key}`,
      );
      r.claim();
      r.commit();
      this.warmBatches.push(r);
      this.warmScene.add(r.mesh);
    }
    for (const [mat, geo] of MESH_PAIRS) {
      const m = new Mesh(this.getGeometry(geo), this.getMaterial(mat));
      m.name = `warm:${mat}:${geo}`;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      this.warmScene.add(m);
    }
  }
}

/** Materials/geometries/textures are created during build(); getMaterial/getGeometry throw before build. */
export function createAssetLibrary(deps: AssetLibraryDeps): ThreeAssetLibrary {
  return new AssetLibrary(deps);
}
