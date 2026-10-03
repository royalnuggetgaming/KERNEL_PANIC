/**
 * Theme data contract: names, palette, geometry recipe params, shader modes, audio params.
 * Themes are pure data; mechanics are theme-neutral. Three themes ship (KERNEL PANIC, ABYSSAL LIGHT, EMBERFALL)
 * with all floor/sky modes implemented; the 'organic'/'mineral' enemy families and 'sub'/'tug' hull styles are
 * still reserved (every theme reuses the platonic/sled meshes, recoloured by its palette).
 */
import type { BossId, EnemyKind, SpecialKind, ThemeId, VehicleId } from './ids';

/** Colours are 0xRRGGBB integers. */
export interface SectorPalette {
  readonly floor: number;
  readonly grid: number;
  readonly accent: number;
  readonly sky: number;
  readonly fog: number;
  readonly enemy: number;
  readonly elite: number;
}

export interface ThemeNames {
  readonly runCurrency: string;
  readonly metaCurrency: string;
  readonly shop: string;
  readonly meta: string;
  readonly lives: string;
  readonly wave: string;
  readonly sector: string;
  readonly vehicles: Readonly<Record<VehicleId, string>>;
  readonly vehicleBlurbs: Readonly<Record<VehicleId, string>>;
  readonly specials: Readonly<Record<SpecialKind, string>>;
  readonly enemies: Readonly<Record<EnemyKind, string>>;
  readonly bosses: Readonly<Record<BossId, string>>;
  readonly teamItems: {
    readonly spareKernel: string;
    readonly linkAmp: string;
    readonly linkRange: string;
    readonly reviveProtocol: string;
  };
  readonly extract: string;
  readonly pushDeeper: string;
  readonly overflow: string;
  readonly versus: string;
  readonly coop: string;
}

export interface ThemePalette {
  readonly p1: number;
  readonly p2: number;
  readonly p2Colorblind: number;
  readonly enemyShot: number;
  readonly enemyShotCore: number;
  readonly pickup: number;
  readonly link: number;
  readonly ui: { readonly bg: number; readonly panel: number; readonly text: number; readonly dim: number };
  readonly sectors: readonly [SectorPalette, SectorPalette, SectorPalette];
}

export type FloorMode = 'GRID' | 'CAUSTICS' | 'LAVA';
export type SkyMode = 'NEBULA_GLYPHS' | 'ABYSS_RAYS' | 'CORONA';
export type EnemyFamily = 'platonic' | 'organic' | 'mineral';
export type HullStyle = 'sled' | 'sub' | 'tug';
export type EmissiveMask = 'edges' | 'spots' | 'seams';

export interface ThemeGeometry {
  readonly enemyFamily: EnemyFamily;
  readonly hullStyle: HullStyle;
  readonly emissiveMask: EmissiveMask;
  /** 0..1 edge-glow width for the barycentric edge term. */
  readonly edgeWidth: number;
}

export interface ThemeShading {
  /** Compile-time define FLOOR_MODE_<floorMode>, fixed at Boot. */
  readonly floorMode: FloorMode;
  /** Compile-time define SKY_MODE_<skyMode>, fixed at Boot. */
  readonly skyMode: SkyMode;
  readonly fogDensity: number;
  readonly heatShimmer: number;
  readonly minEmissive: number;
  readonly bloomStrength: number;
  readonly bloomThreshold: number;
}

export interface ThemeAudio {
  readonly bpm: number;
  readonly rootMidi: number;
  readonly mode: 'aeolian' | 'dorian' | 'phrygian';
  /** Scale-degree roots (0-based semitone offsets) of the chord progression. */
  readonly progression: readonly number[];
  /** Semitone shift per sector (A minor, C minor, E minor => 0, 3, 7). */
  readonly sectorKeyShift: readonly [number, number, number];
  /** Boss waves move up this many semitones. */
  readonly bossKeyShift: number;
  readonly timbre: 'synthwave' | 'abyssal' | 'industrial';
}

export interface ThemeDef {
  readonly id: ThemeId;
  readonly title: string;
  readonly tagline: string;
  readonly names: ThemeNames;
  readonly palette: ThemePalette;
  readonly geometry: ThemeGeometry;
  readonly shading: ThemeShading;
  readonly audio: ThemeAudio;
}
