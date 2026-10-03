/**
 * Every ShaderMaterial is created here, once, at Boot (GLSL3, theme defines, shared uniforms merged by
 * reference). Program-affecting state (defines, side, blending, instancing attributes, vertexColors) is fixed
 * at creation and never toggled; fog is the custom uFog uniform (fog: false). The registry is frozen after
 * Boot: creating a material afterwards throws in DEV and logs an error in PROD.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  GLSL3,
  NoBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Blending,
  type IUniform,
  type Side,
} from 'three';
import { ARENA } from '../config/tuning';
import type { Logger } from '../contracts/ids';
import type { MaterialKey } from '../contracts/render';
import type { ThemeDef } from '../contracts/theme';
import type { SharedUniforms } from '../render/assetTypes';
import { BEAM } from '../shaders/beam';
import { DECAL } from '../shaders/decal';
import { DIGITS } from '../shaders/digits';
import { FLOOR } from '../shaders/floor';
import { FORCE_FIELD } from '../shaders/forceField';
import { MARKER } from '../shaders/marker';
import { NEON_SURFACE } from '../shaders/neonSurface';
import { PARTICLE } from '../shaders/particle';
import { PROJECTILE } from '../shaders/projectile';
import type { ShaderDefines, ShaderSource } from '../shaders/shaderSource';
import { SHOCKWAVE } from '../shaders/shockwave';
import { SKY } from '../shaders/sky';
import { TINT } from '../shaders/tints';
import { TRAIL } from '../shaders/trail';
import { SHARED_UNIFORM_NAMES, type SharedUniformName } from '../shaders/uniformNames';

export type PostMaterialKey = Extract<MaterialKey, `post:${string}`>;
export type SceneMaterialKey = Exclude<MaterialKey, PostMaterialKey>;

export const POST_MATERIAL_KEYS: readonly PostMaterialKey[] = [
  'post:blit',
  'post:prefilter',
  'post:down',
  'post:up',
  'post:composite',
];

export const SCENE_MATERIAL_KEYS: readonly SceneMaterialKey[] = [
  'hull:0',
  'hull:1',
  'boss',
  'enemy',
  'floor',
  'sky',
  'wall',
  'pylon',
  'pickup',
  'projectile',
  'particle',
  'beam',
  'decal',
  'marker',
  'digits',
  'shockwave',
  'trail',
  'shield',
  'title',
];

/** Compile-time proof that SHARED_UNIFORM_NAMES covers exactly the SharedUniforms keys. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const SHARED_UNIFORMS_IN_SYNC: Exact<SharedUniformName, keyof SharedUniforms> = true;

export function createSharedUniforms(theme: ThemeDef): SharedUniforms {
  const s = theme.palette.sectors[0];
  const fog = new Color(s.fog);
  return {
    uTime: { value: 0 },
    uSimTime: { value: 0 },
    uBeat: { value: 0 },
    uPalette: {
      value: [s.floor, s.grid, s.accent, s.sky, s.fog, s.enemy, s.elite].map((h) => new Color(h)),
    },
    uP1Color: { value: new Color(theme.palette.p1) },
    uP2Color: { value: new Color(theme.palette.p2) },
    uEnemyShotColor: { value: new Color(theme.palette.enemyShot) },
    uRipples: { value: Array.from({ length: 8 }, () => new Vector4(0, 0, -1e4, 0)) },
    uPlayerPos: { value: [new Vector3(0, 0, 0), new Vector3(0, 0, 0)] },
    uFog: { value: new Vector4(fog.r, fog.g, fog.b, theme.shading.fogDensity) },
    uResolution: { value: new Vector2(1, 1) },
    uMinEmissive: { value: theme.shading.minEmissive },
    uNoiseTex: { value: null },
    uReduceFlashes: { value: 0 },
  };
}

/** Writes a sector's palette (1-3) and fog colour into the shared uniforms (no allocation). */
export function applySectorPalette(u: SharedUniforms, theme: ThemeDef, sector: 1 | 2 | 3): void {
  const s = theme.palette.sectors[sector - 1]!;
  const pal = u.uPalette.value;
  pal[0]?.setHex(s.floor);
  pal[1]?.setHex(s.grid);
  pal[2]?.setHex(s.accent);
  pal[3]?.setHex(s.sky);
  pal[4]?.setHex(s.fog);
  pal[5]?.setHex(s.enemy);
  pal[6]?.setHex(s.elite);
  const fog = pal[4];
  if (fog !== undefined) u.uFog.value.set(fog.r, fog.g, fog.b, theme.shading.fogDensity);
}

interface MaterialSpec {
  readonly source: ShaderSource;
  readonly defines?: ShaderDefines;
  readonly blending: Blending;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
  readonly depthTest: boolean;
  readonly side: Side;
  readonly vertexColors: boolean;
  readonly setup?: (u: Record<string, IUniform>) => void;
}

const OPAQUE = {
  blending: NoBlending,
  transparent: false,
  depthWrite: true,
  depthTest: true,
  side: FrontSide,
} as const;
const ADDITIVE = {
  blending: AdditiveBlending,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  side: DoubleSide,
} as const;

function writeRgb(u: IUniform | undefined, hex: number): void {
  const arr: unknown = u?.value;
  if (!(arr instanceof Float32Array)) return;
  const c = new Color(hex);
  arr[0] = c.r;
  arr[1] = c.g;
  arr[2] = c.b;
}

function setNumber(u: IUniform | undefined, v: number): void {
  if (u !== undefined) u.value = v;
}

function emissiveDefine(theme: ThemeDef): number {
  return theme.geometry.emissiveMask === 'edges' ? 1 : 0;
}

/** Exactly one FLOOR_MODE_<mode> define, fixed at Boot (the program never changes at runtime). */
export function floorDefines(theme: ThemeDef): ShaderDefines {
  return { [`FLOOR_MODE_${theme.shading.floorMode}`]: 1 };
}

/** Exactly one SKY_MODE_<mode> define, fixed at Boot. */
export function skyDefines(theme: ThemeDef): ShaderDefines {
  return { [`SKY_MODE_${theme.shading.skyMode}`]: 1 };
}

/** LOW_FX is tested with #ifdef in the shaders, so it is only present (= 1) when on. */
function lowFxDefines(lowFx: boolean): ShaderDefines {
  return lowFx ? { LOW_FX: 1 } : {};
}

function sceneSpec(key: SceneMaterialKey, theme: ThemeDef, lowFx: boolean): MaterialSpec {
  const neon = (instanced: 0 | 1, spin: 0 | 1, tint: number): MaterialSpec => ({
    source: NEON_SURFACE,
    defines: {
      INSTANCED: instanced,
      SPIN: spin,
      EMISSIVE_MASK_EDGES: emissiveDefine(theme),
      ...lowFxDefines(lowFx),
    },
    ...OPAQUE,
    vertexColors: true,
    setup: (u) => {
      setNumber(u.uTintIndex, tint);
      setNumber(u.uEdgeWidth, theme.geometry.edgeWidth);
    },
  });
  const additive = (source: ShaderSource, setup?: (u: Record<string, IUniform>) => void): MaterialSpec =>
    setup === undefined
      ? { source, ...ADDITIVE, vertexColors: false }
      : { source, ...ADDITIVE, vertexColors: false, setup };
  switch (key) {
    case 'hull:0':
      return neon(0, 0, TINT.P1);
    case 'hull:1':
      return neon(0, 0, TINT.P2);
    case 'boss':
      return neon(0, 0, TINT.ENEMY);
    case 'pylon':
    case 'title':
      return neon(0, 0, TINT.ACCENT);
    case 'enemy':
      return neon(1, 0, TINT.ENEMY);
    case 'pickup':
      return neon(1, 1, TINT.PICKUP);
    case 'floor':
      return {
        source: FLOOR,
        defines: { ...floorDefines(theme), ...lowFxDefines(lowFx) },
        ...OPAQUE,
        vertexColors: false,
        setup: (u) => {
          setNumber(u.uArenaRadius, ARENA.RADIUS);
          setNumber(u.uCellSize, ARENA.GRID_CELL);
        },
      };
    case 'sky':
      return {
        source: SKY,
        defines: { ...skyDefines(theme), ...lowFxDefines(lowFx) },
        ...OPAQUE,
        depthWrite: false,
        vertexColors: false,
      };
    case 'wall':
      return {
        ...additive(FORCE_FIELD, (u) => {
          const scale: unknown = u.uUvScale?.value;
          if (scale instanceof Float32Array) {
            scale[0] = Math.round((2 * Math.PI * ARENA.RADIUS) / 1.4);
            scale[1] = 2.2;
          }
          setNumber(u.uTintIndex, TINT.ACCENT);
        }),
        defines: { INSTANCED: 0 },
      };
    case 'shield':
      return {
        ...additive(FORCE_FIELD, (u) => {
          const scale: unknown = u.uUvScale?.value;
          if (scale instanceof Float32Array) {
            scale[0] = 18;
            scale[1] = 5;
          }
        }),
        defines: { INSTANCED: 1 },
      };
    case 'projectile':
      return additive(PROJECTILE, (u) => {
        writeRgb(u.uShotCore, theme.palette.enemyShotCore);
      });
    case 'particle':
      return additive(PARTICLE);
    case 'beam':
      return additive(BEAM);
    case 'decal':
      return { ...additive(DECAL), side: FrontSide };
    case 'marker':
      return { ...additive(MARKER), depthTest: false };
    case 'digits':
      return { ...additive(DIGITS), depthTest: false };
    case 'shockwave':
      return additive(SHOCKWAVE);
    case 'trail':
      return additive(TRAIL);
  }
}

export interface MaterialRegistryDeps {
  readonly theme: ThemeDef;
  readonly shared: SharedUniforms;
  readonly log: Logger;
  /** Post sources (shaders/post, owned by the render agent). */
  readonly post: Readonly<Record<PostMaterialKey, ShaderSource>>;
  /**
   * LOW_FX shader variant (Chromebook quality) for floor/sky/neonSurface: one value for every material, fixed at
   * Boot like the theme modes, so the program count is the same either way. Default false.
   */
  readonly lowFx?: boolean;
}

export interface MaterialRegistry {
  readonly frozen: boolean;
  /** Creates the material for `key` (once). After freeze(): throws in DEV, logs an error in PROD. */
  create(key: MaterialKey): ShaderMaterial;
  get(key: MaterialKey): ShaderMaterial;
  has(key: MaterialKey): boolean;
  freeze(): void;
  all(): readonly ShaderMaterial[];
  dispose(): void;
}

function mergeUniforms(source: ShaderSource, shared: SharedUniforms): Record<string, IUniform> {
  const u: Record<string, IUniform> = { ...source.createUniforms() };
  for (const name of SHARED_UNIFORM_NAMES) u[name] = shared[name];
  return u;
}

export function createMaterialRegistry(deps: MaterialRegistryDeps): MaterialRegistry {
  const map = new Map<MaterialKey, ShaderMaterial>();
  let frozen = false;
  const build = (key: MaterialKey): ShaderMaterial => {
    if (key.startsWith('post:')) {
      const source = deps.post[key as PostMaterialKey];
      return new ShaderMaterial({
        name: `${key}:${source.name}`,
        vertexShader: source.vertex,
        fragmentShader: source.fragment,
        defines: { ...source.defines },
        uniforms: mergeUniforms(source, deps.shared),
        glslVersion: GLSL3,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
        transparent: false,
        fog: false,
        lights: false,
        toneMapped: false,
      });
    }
    const spec = sceneSpec(key as SceneMaterialKey, deps.theme, deps.lowFx === true);
    const uniforms = mergeUniforms(spec.source, deps.shared);
    writeRgb(uniforms.uPickupColor, deps.theme.palette.pickup);
    writeRgb(uniforms.uLinkColor, deps.theme.palette.link);
    spec.setup?.(uniforms);
    return new ShaderMaterial({
      name: `${key}:${spec.source.name}`,
      vertexShader: spec.source.vertex,
      fragmentShader: spec.source.fragment,
      defines: { ...spec.source.defines, ...spec.defines },
      uniforms,
      glslVersion: GLSL3,
      blending: spec.blending,
      transparent: spec.transparent,
      depthWrite: spec.depthWrite,
      depthTest: spec.depthTest,
      side: spec.side,
      vertexColors: spec.vertexColors,
      fog: false,
      lights: false,
      toneMapped: false,
    });
  };
  return {
    get frozen(): boolean {
      return frozen;
    },
    create(key: MaterialKey): ShaderMaterial {
      if (frozen) {
        const msg = `material '${key}' created after Boot (registry frozen)`;
        if (__DEV__) throw new Error(msg);
        deps.log.error(msg);
      }
      const existing = map.get(key);
      if (existing !== undefined) return existing;
      const m = build(key);
      map.set(key, m);
      return m;
    },
    get(key: MaterialKey): ShaderMaterial {
      const m = map.get(key);
      if (m === undefined) throw new Error(`material '${key}' does not exist (not built yet?)`);
      return m;
    },
    has(key: MaterialKey): boolean {
      return map.has(key);
    },
    freeze(): void {
      frozen = true;
    },
    all(): readonly ShaderMaterial[] {
      return Array.from(map.values());
    },
    dispose(): void {
      for (const m of map.values()) m.dispose();
      map.clear();
    },
  };
}
