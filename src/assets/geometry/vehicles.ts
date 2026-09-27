/**
 * Player craft ('sled' hull style): parametric mirrored hover-sled hulls lofted from per-vehicle station
 * profiles, plus canopy, engine pods with glowing exhausts, fins and vehicle-specific details. Local space:
 * +Z forward (yaw convention forward = (sin yaw, cos yaw)), +Y up, belly at SLED_BELLY_Y, authored at world
 * size (craft radius about 0.9 u). The hull tint comes from the material (hull:0 / hull:1).
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Matrix4,
  OctahedronGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Vector2,
  type BufferGeometry,
} from 'three';
import type { VehicleId } from '../../contracts/ids';
import type { ThemeDef } from '../../contracts/theme';
import { loft, sledSection, type LoftSection } from './loft';
import { MeshBuilder } from './MeshBuilder';
import { IDENTITY_Q, triangleGeometry, vec3 } from './shapes';

export const SLED_BELLY_Y = 0.22;

const HULL_DARK = 0x1a2030;
const HULL_PANEL = 0x364056;
const TRIM = 0x8a96b0;

/** Station: [z, half width, height]. Listed tail to nose. */
type Station = readonly [number, number, number];

export interface SledRecipe {
  readonly stations: readonly Station[];
  readonly noseZ: number;
  readonly canopy: { readonly z: number; readonly len: number; readonly width: number };
  readonly pods: { readonly x: number; readonly z: number; readonly len: number; readonly r: number };
  readonly fin: { readonly x: number; readonly span: number; readonly chord: number; readonly sweep: number };
}

export const SLED_RECIPES: Readonly<Record<VehicleId, SledRecipe>> = {
  lancer: {
    stations: [
      [-0.9, 0.42, 0.34],
      [-0.4, 0.55, 0.4],
      [0.3, 0.46, 0.34],
      [0.8, 0.22, 0.2],
    ],
    noseZ: 1.08,
    canopy: { z: 0.05, len: 0.42, width: 0.2 },
    pods: { x: 0.52, z: -0.62, len: 0.6, r: 0.13 },
    fin: { x: 0.42, span: 0.42, chord: 0.4, sweep: 0.25 },
  },
  bulwark: {
    stations: [
      [-0.85, 0.6, 0.42],
      [-0.3, 0.75, 0.5],
      [0.4, 0.7, 0.44],
      [0.78, 0.5, 0.3],
    ],
    noseZ: 0.95,
    canopy: { z: -0.05, len: 0.36, width: 0.26 },
    pods: { x: 0.72, z: -0.55, len: 0.7, r: 0.17 },
    fin: { x: 0.55, span: 0.3, chord: 0.35, sweep: 0.1 },
  },
  specter: {
    stations: [
      [-1.0, 0.3, 0.26],
      [-0.5, 0.4, 0.3],
      [0.35, 0.3, 0.24],
      [0.9, 0.12, 0.14],
    ],
    noseZ: 1.2,
    canopy: { z: 0.1, len: 0.5, width: 0.16 },
    pods: { x: 0.36, z: -0.75, len: 0.55, r: 0.1 },
    fin: { x: 0.3, span: 0.7, chord: 0.55, sweep: 0.5 },
  },
  tinker: {
    stations: [
      [-0.85, 0.46, 0.36],
      [-0.35, 0.58, 0.44],
      [0.35, 0.52, 0.4],
      [0.75, 0.3, 0.26],
    ],
    noseZ: 0.98,
    canopy: { z: 0.12, len: 0.38, width: 0.24 },
    pods: { x: 0.6, z: -0.5, len: 0.5, r: 0.16 },
    fin: { x: 0.38, span: 0.3, chord: 0.3, sweep: 0.15 },
  },
};

function hullSections(r: SledRecipe): LoftSection[] {
  const out: LoftSection[] = [];
  for (const [z, w, h] of r.stations) out.push(sledSection(z, w, h, SLED_BELLY_Y));
  return out;
}

function deckY(r: SledRecipe, z: number): number {
  let best = r.stations[0]!;
  for (const s of r.stations) if (Math.abs(s[0] - z) < Math.abs(best[0] - z)) best = s;
  return SLED_BELLY_Y + best[2];
}

function addSled(mb: MeshBuilder, r: SledRecipe): void {
  const hull = loft(hullSections(r), { z: r.noseZ, y: SLED_BELLY_Y + 0.08 });
  mb.addTriangles(hull.skin, { color: HULL_DARK });
  mb.addTriangles(hull.front, { color: HULL_PANEL });
  mb.addTriangles(hull.rear, { color: HULL_PANEL, emissive: 0.6 });

  // Canopy: stretched octahedron on the deck, glowing.
  const cy = deckY(r, r.canopy.z);
  mb.add(new OctahedronGeometry(1, 0), {
    matrix: new Matrix4().compose(
      vec3(0, cy, r.canopy.z),
      IDENTITY_Q,
      vec3(r.canopy.width, 0.14, r.canopy.len),
    ),
    color: TRIM,
    emissive: 0.75,
  });

  // Engine pods along z with glowing exhaust rings at the rear.
  const podGeo = new CylinderGeometry(r.pods.r, r.pods.r * 0.8, r.pods.len, 8, 1);
  const podZ0 = r.pods.z - r.pods.len / 2;
  mb.addMirroredX(podGeo, {
    matrix: new Matrix4()
      .makeTranslation(r.pods.x, SLED_BELLY_Y + r.pods.r + 0.02, r.pods.z)
      .multiply(new Matrix4().makeRotationX(Math.PI / 2)),
    color: HULL_PANEL,
    emissiveFn: (p) => (p.z < podZ0 + 0.08 ? 1 : 0),
  });

  // Fins: thin swept quads with glowing leading edges.
  const f = r.fin;
  const baseY = SLED_BELLY_Y + 0.2;
  const finTris = [
    f.x,
    baseY,
    -0.2 + f.chord * 0.5,
    f.x + f.span,
    baseY + 0.12,
    -0.2 - f.sweep,
    f.x,
    baseY,
    -0.2 - f.chord * 0.5,
  ];
  mb.addMirroredX(triangleGeometry(finTris, 0.03), { color: HULL_PANEL, emissive: 0.35 });
}

function addDetails(mb: MeshBuilder, id: VehicleId, r: SledRecipe): void {
  switch (id) {
    case 'lancer': {
      const barrel = new BoxGeometry(0.08, 0.08, 0.55);
      mb.addMirroredX(barrel, {
        matrix: new Matrix4().makeTranslation(0.3, SLED_BELLY_Y + 0.22, 0.72),
        color: TRIM,
        emissiveFn: (p) => (p.z > 0.95 ? 1 : 0),
      });
      return;
    }
    case 'bulwark': {
      mb.add(new BoxGeometry(1.5, 0.16, 0.14), {
        matrix: new Matrix4().makeTranslation(0, SLED_BELLY_Y + 0.14, r.noseZ - 0.12),
        color: HULL_PANEL,
        emissive: 0.5,
      });
      mb.add(new BoxGeometry(0.5, 0.1, 0.3), {
        matrix: new Matrix4().makeTranslation(0, deckY(r, -0.4) + 0.05, -0.45),
        color: TRIM,
      });
      return;
    }
    case 'specter': {
      mb.add(new CylinderGeometry(0.03, 0.05, 0.6, 6, 1), {
        matrix: new Matrix4()
          .makeTranslation(0, SLED_BELLY_Y + 0.18, r.noseZ - 0.35)
          .multiply(new Matrix4().makeRotationX(Math.PI / 2)),
        color: TRIM,
        emissive: 0.9,
      });
      return;
    }
    case 'tinker': {
      const dish = new LatheGeometry(
        [new Vector2(0.02, 0), new Vector2(0.18, 0.05), new Vector2(0.24, 0.12)],
        10,
      );
      mb.add(dish, {
        matrix: new Matrix4().makeTranslation(0, deckY(r, -0.3), -0.3),
        color: TRIM,
        emissive: 0.4,
        edges: 'none',
      });
      mb.addMirroredX(new IcosahedronGeometry(0.1, 0), {
        matrix: new Matrix4().makeTranslation(r.pods.x, SLED_BELLY_Y + 0.42, r.pods.z + 0.1),
        color: TRIM,
        emissive: 1,
      });
      return;
    }
  }
}

export function buildVehicleGeometry(id: VehicleId, theme: ThemeDef): BufferGeometry {
  const style = theme.geometry.hullStyle;
  if (style !== 'sled') {
    throw new Error(`buildVehicleGeometry: hull style '${style}' is reserved for a future theme`);
  }
  const recipe = SLED_RECIPES[id];
  const mb = new MeshBuilder();
  addSled(mb, recipe);
  addDetails(mb, id, recipe);
  return mb.build(`vehicle:${id}`);
}
