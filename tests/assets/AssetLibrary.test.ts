import { AdditiveBlending, GLSL3, InstancedBufferGeometry, Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createAssetLibrary } from '../../src/assets/AssetLibrary';
import {
  BATCH_SPECS,
  MARKER_CAPACITY,
  MESH_PAIRS,
  MISSILE_CAPACITY,
  RING_SPECS,
} from '../../src/assets/batchSpecs';
import { buildVoxelText } from '../../src/assets/geometry/voxelFont';
import {
  applySectorPalette,
  createMaterialRegistry,
  createSharedUniforms,
  POST_MATERIAL_KEYS,
  SCENE_MATERIAL_KEYS,
  SHARED_UNIFORMS_IN_SYNC,
} from '../../src/assets/materials';
import { QUALITY_PRESETS } from '../../src/config/quality';
import { CAPACITY } from '../../src/config/tuning';
import { BOSS_IDS, ENEMY_KINDS, PLAYER_INDICES, VEHICLE_IDS } from '../../src/contracts/ids';
import type { GeometryKey, MaterialKey } from '../../src/contracts/render';
import { createMemoryLogger, NullLogger } from '../../src/core/logger';
import { BLIT, BLOOM_PREFILTER, KAWASE_DOWN, KAWASE_UP } from '../../src/shaders/post/bloom';
import { COMPOSITE } from '../../src/shaders/post/composite';
import { SHARED_UNIFORM_NAMES } from '../../src/shaders/uniformNames';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { THEMES } from '../../src/themes/registry';

const ALL_GEOMETRY_KEYS: readonly GeometryKey[] = [
  ...VEHICLE_IDS.map((v) => `vehicle:${v}` as const),
  ...ENEMY_KINDS.map((k) => `enemy:${k}` as const),
  ...BOSS_IDS.map((b) => `boss:${b}` as const),
  'arena:floor',
  'arena:wall',
  'arena:pylon',
  'arena:sky',
  'pickup',
  'shield',
  'title',
  'fx:quad',
  'fx:ring',
  'fx:capsule',
  'fx:fullscreen',
  ...PLAYER_INDICES.map((p) => `fx:trail:${p}` as const),
];
const ALL_MATERIAL_KEYS: readonly MaterialKey[] = [...SCENE_MATERIAL_KEYS, ...POST_MATERIAL_KEYS];
const POST = {
  'post:blit': BLIT,
  'post:prefilter': BLOOM_PREFILTER,
  'post:down': KAWASE_DOWN,
  'post:up': KAWASE_UP,
  'post:composite': COMPOSITE,
} as const;

async function builtLibrary() {
  const lib = createAssetLibrary({
    theme: KERNEL_PANIC,
    quality: QUALITY_PRESETS.low,
    log: NullLogger,
    seed: 11,
  });
  const progress: number[] = [];
  await lib.build((p) => progress.push(p));
  return { lib, progress };
}

describe('shared uniforms and material registry', () => {
  it('shared uniform keys match the GLSL shared block', () => {
    expect(SHARED_UNIFORMS_IN_SYNC).toBe(true);
    const u = createSharedUniforms(KERNEL_PANIC);
    expect(Object.keys(u).sort()).toEqual([...SHARED_UNIFORM_NAMES].sort());
    expect(u.uPalette.value).toHaveLength(7);
    expect(u.uRipples.value).toHaveLength(8);
    expect(u.uPlayerPos.value).toHaveLength(2);
    expect(u.uFog.value.w).toBe(KERNEL_PANIC.shading.fogDensity);
  });

  it('applySectorPalette rewrites colours in place', () => {
    const u = createSharedUniforms(KERNEL_PANIC);
    const grid = u.uPalette.value[1]!;
    applySectorPalette(u, KERNEL_PANIC, 3);
    expect(u.uPalette.value[1]).toBe(grid);
    expect(grid.getHex()).toBe(KERNEL_PANIC.palette.sectors[2].grid);
    expect(u.uFog.value.x).toBeCloseTo(u.uPalette.value[4]!.r, 6);
  });

  it('creates GLSL3 materials once, shares uniforms by reference and freezes', () => {
    const shared = createSharedUniforms(KERNEL_PANIC);
    const log = createMemoryLogger();
    const reg = createMaterialRegistry({ theme: KERNEL_PANIC, shared, log, post: POST });
    for (const k of ALL_MATERIAL_KEYS) reg.create(k);
    expect(reg.all()).toHaveLength(ALL_MATERIAL_KEYS.length);
    expect(reg.create('floor')).toBe(reg.get('floor'));
    for (const k of ALL_MATERIAL_KEYS) {
      const m = reg.get(k);
      expect(m.glslVersion).toBe(GLSL3);
      expect(m.fog).toBe(false);
      expect(m.uniforms.uTime).toBe(shared.uTime);
      expect(m.uniforms.uPalette).toBe(shared.uPalette);
      for (const v of Object.values(m.defines)) expect(typeof v).toBe('number');
    }
    expect(reg.get('hull:0').uniforms.uTintIndex!.value).toBe(0);
    expect(reg.get('hull:1').uniforms.uTintIndex!.value).toBe(1);
    expect(reg.get('enemy').defines).toMatchObject({ INSTANCED: 1, SPIN: 0, EMISSIVE_MASK_EDGES: 1 });
    expect(reg.get('pickup').defines).toMatchObject({ INSTANCED: 1, SPIN: 1 });
    expect(reg.get('floor').defines).toEqual({ FLOOR_MODE_GRID: 1 });
    expect(reg.get('sky').defines).toEqual({ SKY_MODE_NEBULA_GLYPHS: 1 });
    expect(reg.get('particle').blending).toBe(AdditiveBlending);
    expect(reg.get('marker').depthTest).toBe(false);
    expect(reg.get('hull:0').vertexColors).toBe(true);
    const shotCore = reg.get('projectile').uniforms.uShotCore!.value as Float32Array;
    expect(shotCore[0]).toBeGreaterThan(0.9);
    reg.freeze();
    expect(reg.frozen).toBe(true);
    expect(() => reg.create('beam')).toThrow(/frozen/);
    expect(() =>
      createMaterialRegistry({ theme: KERNEL_PANIC, shared, log, post: POST }).get('beam'),
    ).toThrow();
    reg.dispose();
    expect(reg.has('floor')).toBe(false);
  });

  // Was 'rejects theme modes that are reserved for future themes': ABYSSAL LIGHT and EMBERFALL now implement them.
  it.each(Object.values(THEMES))('compiles exactly one floor and one sky mode define for $id', (theme) => {
    const reg = createMaterialRegistry({
      theme,
      shared: createSharedUniforms(theme),
      log: NullLogger,
      post: POST,
    });
    expect(reg.create('floor').defines).toEqual({ [`FLOOR_MODE_${theme.shading.floorMode}`]: 1 });
    expect(reg.create('sky').defines).toEqual({ [`SKY_MODE_${theme.shading.skyMode}`]: 1 });
    reg.dispose();
  });
});

describe('AssetLibrary', () => {
  it('throws before build and reports monotonic progress to 1', async () => {
    const lib = createAssetLibrary({
      theme: KERNEL_PANIC,
      quality: QUALITY_PRESETS.high,
      log: NullLogger,
      seed: 1,
    });
    expect(lib.built).toBe(false);
    expect(() => lib.getMaterial('floor')).toThrow(/before build/);
    expect(() => lib.getGeometry('fx:quad')).toThrow(/before build/);
    expect(() => lib.createBatches()).toThrow(/before build/);
    const progress: number[] = [];
    const p1 = lib.build((p) => progress.push(p));
    expect(lib.build(() => undefined)).toBe(p1);
    await p1;
    expect(lib.built).toBe(true);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThan(progress[i - 1]!);
    lib.dispose();
    expect(lib.built).toBe(false);
  });

  it('provides every geometry and material key, and three textures', async () => {
    const { lib } = await builtLibrary();
    for (const k of ALL_GEOMETRY_KEYS)
      expect(lib.getGeometry(k).getAttribute('position').count).toBeGreaterThan(0);
    for (const k of ALL_MATERIAL_KEYS) expect(lib.getMaterial(k).name).toContain(k);
    expect(lib.textures).toHaveLength(3);
    expect(lib.uniforms.uNoiseTex.value).toBe(lib.textures[0]);
    expect(lib.getGeometry('title').getAttribute('position').count).toBe(
      buildVoxelText(KERNEL_PANIC.title).getAttribute('position').count,
    );
    lib.dispose();
  });

  it('allocates every batch and ring at capacity exactly once', async () => {
    const { lib } = await builtLibrary();
    const set = lib.createBatches();
    for (const k of ENEMY_KINDS) {
      expect(set.batches[`enemy:${k}`].capacity).toBe(CAPACITY.enemies);
      expect(set.batches[`enemy:${k}`].mesh.material).toBe(lib.getMaterial('enemy'));
    }
    expect(set.batches.playerShots.capacity).toBe(CAPACITY.playerShots);
    expect(set.batches.enemyShots.capacity).toBe(CAPACITY.enemyShots);
    expect(set.batches.missiles.capacity).toBe(MISSILE_CAPACITY);
    expect(set.batches.markers.capacity).toBe(MARKER_CAPACITY);
    expect(set.batches.pickups.mesh.material).toBe(lib.getMaterial('pickup'));
    expect(set.rings.particles.capacity).toBe(CAPACITY.particles);
    expect(set.rings.particles.stride).toBe(12);
    expect(set.rings.digits.geometry.getAttribute('aD1')).toBeDefined();
    expect(set.rings.shockwaves.geometry.getAttribute('aW0')).toBeDefined();
    expect(() => lib.createBatches()).toThrow(/twice/);
    lib.dispose();
  });

  it('warm scene holds one object per material x geometry x instancing variant', async () => {
    const { lib } = await builtLibrary();
    const combos = new Set<string>();
    let instanced = 0;
    lib.warmScene.traverse((o: Object3D) => {
      if (!(o instanceof Mesh)) return;
      const mat = ALL_MATERIAL_KEYS.find((k) => lib.getMaterial(k) === o.material);
      expect(mat).toBeDefined();
      if (o.geometry instanceof InstancedBufferGeometry) {
        instanced++;
        expect(o.geometry.instanceCount).toBe(1);
        expect(o.visible).toBe(true);
      }
      combos.add(`${mat!}|${o.name}`);
    });
    expect(instanced).toBe(BATCH_SPECS.length + RING_SPECS.length);
    expect(combos.size).toBe(BATCH_SPECS.length + RING_SPECS.length + MESH_PAIRS.length);
    const usedMaterials = new Set<MaterialKey>([
      ...BATCH_SPECS.map((s) => s.material),
      ...RING_SPECS.map((s) => s.material),
      ...MESH_PAIRS.map(([m]) => m),
    ]);
    expect([...usedMaterials].sort()).toEqual([...ALL_MATERIAL_KEYS].sort());
    lib.dispose();
    expect(lib.warmScene.children).toHaveLength(0);
  });
});
