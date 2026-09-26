/**
 * Enemy meshes, 'platonic' family (KERNEL PANIC glitch processes). Authored at world size around the config
 * collision radius (instance scale 1 = config radius), centred at hover height enemyHoverY(kind), +Z forward.
 *   shard  tetrahedron chaser        dart  stretched octahedron with fins
 *   fork   split cube (glowing seam) spiker dodecahedron with 12 face spikes
 *   warden icosahedron + 100 deg front shield arc   leech torus with inward hooks
 */
import {
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  Matrix4,
  OctahedronGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  BoxGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { ENEMY_DEFS } from '../../config/enemies';
import type { EnemyKind } from '../../contracts/ids';
import type { ThemeDef } from '../../contracts/theme';
import { MeshBuilder } from './MeshBuilder';
import { spikeGeometry, triangleGeometry, trs } from './shapes';

const BODY = 0x222a3c;
const PLATE = 0x3a4560;

/** Hover height of an enemy's centre (u). */
export function enemyHoverY(kind: EnemyKind): number {
  return ENEMY_DEFS[kind].radius + 0.25;
}

/** Icosahedron vertex directions (= dodecahedron face normals). */
function icosaDirections(): Vector3[] {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: readonly (readonly [number, number, number])[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  return raw.map(([x, y, z]) => new Vector3(x, y, z).normalize());
}

function buildPlatonic(mb: MeshBuilder, kind: EnemyKind): void {
  const r = ENEMY_DEFS[kind].radius;
  const y = enemyHoverY(kind);
  switch (kind) {
    case 'shard': {
      mb.add(new TetrahedronGeometry(r, 0), { matrix: trs(0, y, 0, 0, Math.PI / 4, 0), color: BODY, emissive: 0.1 });
      mb.add(new OctahedronGeometry(r * 0.28, 0), { matrix: trs(0, y, 0), color: PLATE, emissive: 1 });
      return;
    }
    case 'dart': {
      mb.add(new OctahedronGeometry(r, 0), { matrix: trs(0, y, 0, 0, 0, 0, 0.5, 0.45, 1), color: BODY, emissive: 0.1 });
      const fin = [0, y, -0.1, 0, y + r * 0.7, -r * 0.85, 0, y, -r * 0.7];
      mb.add(triangleGeometry(fin, 0.04), { color: PLATE, emissive: 0.6 });
      const side = [0.12, y, 0.1, r * 0.72, y - 0.05, -r * 0.6, 0.12, y, -r * 0.55];
      mb.addMirroredX(triangleGeometry(side, 0.04), { color: PLATE, emissive: 0.4 });
      return;
    }
    case 'fork': {
      const h = r / Math.sqrt(3);
      const gap = 0.05;
      const half = new BoxGeometry(h - gap, 2 * h, 2 * h);
      mb.addMirroredX(half, {
        matrix: trs((h + gap) / 2, y, 0),
        color: BODY,
        emissiveFn: (p) => (Math.abs(p.x) < gap + 0.02 ? 1 : 0.05),
      });
      mb.add(new BoxGeometry(gap * 1.6, h * 1.4, h * 1.4), { matrix: trs(0, y, 0), color: PLATE, emissive: 1 });
      return;
    }
    case 'spiker': {
      const core = r * 0.7;
      mb.add(new DodecahedronGeometry(core, 0), { matrix: trs(0, y, 0), color: BODY, emissive: 0.1 });
      const inr = core * 0.7947;
      const centre = new Vector3(0, y, 0);
      for (const d of icosaDirections()) {
        const base = centre.clone().addScaledVector(d, inr * 0.98);
        mb.add(spikeGeometry(base, d, core * 0.16, r - inr), {
          color: PLATE,
          emissiveFn: (p) => Math.min(1, Math.max(0, (p.distanceTo(centre) - inr) / (r - inr))),
        });
      }
      return;
    }
    case 'warden': {
      mb.add(new IcosahedronGeometry(r * 0.72, 0), { matrix: trs(0, y, 0), color: BODY, emissive: 0.1 });
      const arc = (100 * Math.PI) / 180;
      const shield = new CylinderGeometry(r * 0.96, r * 0.96, r * 0.9, 10, 1, true, -arc / 2, arc);
      mb.add(shield, { matrix: trs(0, y, 0), color: PLATE, emissive: 0.85, flat: true });
      const inner = new CylinderGeometry(r * 0.9, r * 0.9, r * 0.9, 10, 1, true, -arc / 2, arc);
      // Inner face of the shield (mirrored in z then rotated back gives inward-facing winding).
      mb.add(inner, {
        matrix: new Matrix4().makeTranslation(0, y, 0).multiply(new Matrix4().makeScale(-1, 1, 1)),
        color: BODY,
        emissive: 0.3,
      });
      return;
    }
    case 'leech': {
      const tube = r * 0.26;
      mb.add(new TorusGeometry(r - tube, tube, 8, 18), {
        matrix: trs(0, y, 0, Math.PI / 2, 0, 0),
        color: BODY,
        flat: false,
        edges: 'feature',
        featureAngleDeg: 30,
        emissive: 0.2,
      });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const d = new Vector3(-Math.sin(a), 0, -Math.cos(a));
        const base = new Vector3(Math.sin(a) * (r - tube * 2), y, Math.cos(a) * (r - tube * 2));
        mb.add(spikeGeometry(base, d, tube * 0.5, r * 0.35), { color: PLATE, emissive: 0.9 });
      }
      return;
    }
  }
}

export function buildEnemyGeometry(kind: EnemyKind, theme: ThemeDef): BufferGeometry {
  const family = theme.geometry.enemyFamily;
  if (family !== 'platonic') {
    throw new Error(`buildEnemyGeometry: enemy family '${family}' is reserved for a future theme`);
  }
  const mb = new MeshBuilder();
  buildPlatonic(mb, kind);
  return mb.build(`enemy:${kind}`);
}
