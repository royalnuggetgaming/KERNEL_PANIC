/**
 * Which geometry, material and capacity every InstanceBatch and GpuRingBuffer uses (createBatches and the
 * warm scene share this table so every material x geometry x instancing variant is warmed exactly once).
 */
import { CAPACITY } from '../config/tuning';
import { ENEMY_KINDS, PLAYER_INDICES, BOSS_IDS, VEHICLE_IDS } from '../contracts/ids';
import type { BatchKey, GeometryKey, MaterialKey, RingKey } from '../contracts/render';
import {
  DIGIT_RECORD,
  PARTICLE_RECORD,
  SHOCKWAVE_RECORD,
  type RingRecordLayout,
} from '../shaders/ringLayouts';

export interface BatchSpec {
  readonly key: BatchKey;
  readonly geometry: GeometryKey;
  readonly material: MaterialKey;
  readonly capacity: number;
}

export interface RingSpec {
  readonly key: RingKey;
  readonly geometry: GeometryKey;
  readonly material: MaterialKey;
  readonly capacity: number;
  readonly layout: RingRecordLayout;
}

/** Missiles are a subset of player shots (Micro-Missiles, Blink Swarm mines); densely re-pushed each frame. */
export const MISSILE_CAPACITY = 256;
/** Chevron + bleed + revive + dash + special per player can exceed CAPACITY.markers (8): allocate double. */
export const MARKER_CAPACITY = CAPACITY.markers * 2;

export const BATCH_SPECS: readonly BatchSpec[] = [
  ...ENEMY_KINDS.map(
    (k): BatchSpec => ({
      key: `enemy:${k}`,
      geometry: `enemy:${k}`,
      material: 'enemy',
      capacity: CAPACITY.enemies,
    }),
  ),
  { key: 'playerShots', geometry: 'fx:capsule', material: 'projectile', capacity: CAPACITY.playerShots },
  { key: 'enemyShots', geometry: 'fx:capsule', material: 'projectile', capacity: CAPACITY.enemyShots },
  { key: 'missiles', geometry: 'fx:capsule', material: 'projectile', capacity: MISSILE_CAPACITY },
  { key: 'pickups', geometry: 'pickup', material: 'pickup', capacity: CAPACITY.pickups },
  { key: 'decals', geometry: 'fx:quad', material: 'decal', capacity: CAPACITY.decals },
  { key: 'beams', geometry: 'fx:quad', material: 'beam', capacity: CAPACITY.beams },
  { key: 'markers', geometry: 'fx:quad', material: 'marker', capacity: MARKER_CAPACITY },
  { key: 'shields', geometry: 'shield', material: 'shield', capacity: CAPACITY.shields },
];

export const RING_SPECS: readonly RingSpec[] = [
  {
    key: 'particles',
    geometry: 'fx:quad',
    material: 'particle',
    capacity: CAPACITY.particles,
    layout: PARTICLE_RECORD,
  },
  {
    key: 'shockwaves',
    geometry: 'fx:quad',
    material: 'shockwave',
    capacity: CAPACITY.shockwaves,
    layout: SHOCKWAVE_RECORD,
  },
  { key: 'digits', geometry: 'fx:quad', material: 'digits', capacity: CAPACITY.digits, layout: DIGIT_RECORD },
];

/** Non-instanced (plain Mesh) material x geometry pairs used by the scenes. */
export const MESH_PAIRS: readonly (readonly [MaterialKey, GeometryKey])[] = [
  ...VEHICLE_IDS.map((v): [MaterialKey, GeometryKey] => ['hull:0', `vehicle:${v}`]),
  ...VEHICLE_IDS.map((v): [MaterialKey, GeometryKey] => ['hull:1', `vehicle:${v}`]),
  ...BOSS_IDS.map((b): [MaterialKey, GeometryKey] => ['boss', `boss:${b}`]),
  ['floor', 'arena:floor'],
  ['sky', 'arena:sky'],
  ['wall', 'arena:wall'],
  ['pylon', 'arena:pylon'],
  ['title', 'title'],
  ...PLAYER_INDICES.map((p): [MaterialKey, GeometryKey] => ['trail', `fx:trail:${p}`]),
  ['post:blit', 'fx:fullscreen'],
  ['post:prefilter', 'fx:fullscreen'],
  ['post:down', 'fx:fullscreen'],
  ['post:up', 'fx:fullscreen'],
  ['post:composite', 'fx:fullscreen'],
];
