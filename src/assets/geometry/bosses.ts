/**
 * Boss meshes (composite, non-instanced, material 'boss'). Authored at world size around the config radius,
 * centred at bossHoverY(id), +Z forward.
 *   forkBomb       2x2x2 cluster of subdivided cubes around a glowing core, emissive seams
 *   raceCondition  torus-knot core around an icosahedral heart (BossView counter-rotates the twins)
 *   kernel         nested ring lattice on three axes, firewall blocks on the outer ring, glowing core
 */
import {
  BoxGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  type BufferGeometry,
} from 'three';
import { BOSS_DEFS } from '../../config/bosses';
import type { BossId } from '../../contracts/ids';
import type { ThemeDef } from '../../contracts/theme';
import { MeshBuilder } from './MeshBuilder';
import { trs } from './shapes';

const BODY = 0x1e2536;
const PLATE = 0x3b4662;

export function bossHoverY(id: BossId): number {
  return BOSS_DEFS[id].radius + 0.4;
}

function forkBomb(mb: MeshBuilder, r: number, y: number): void {
  const gap = 0.12;
  const h = (r * 0.95) / Math.sqrt(3) / 2 - gap / 4;
  const o = h + gap / 2;
  for (let i = 0; i < 8; i++) {
    const sx = i & 1 ? 1 : -1;
    const sy = i & 2 ? 1 : -1;
    const sz = i & 4 ? 1 : -1;
    mb.add(new BoxGeometry(2 * h, 2 * h, 2 * h, 2, 2, 2), {
      matrix: trs(sx * o, y + sy * o, sz * o),
      color: i % 3 === 0 ? PLATE : BODY,
      emissiveFn: (p) => {
        const lx = Math.abs(p.x);
        const ly = Math.abs(p.y - y);
        const lz = Math.abs(p.z);
        return Math.min(lx, ly, lz) < gap * 0.75 ? 1 : 0.04;
      },
    });
  }
  mb.add(new OctahedronGeometry(gap * 2.2, 0), { matrix: trs(0, y, 0), color: PLATE, emissive: 1 });
}

function raceCondition(mb: MeshBuilder, r: number, y: number): void {
  const knotR = r * 0.55;
  const tube = r * 0.14;
  mb.add(new TorusKnotGeometry(knotR, tube, 120, 8, 2, 3), {
    matrix: trs(0, y, 0),
    color: BODY,
    flat: false,
    featureAngleDeg: 28,
    emissiveFn: (_p, n) => (Math.abs(n.y) > 0.92 ? 0.8 : 0.05),
  });
  mb.add(new IcosahedronGeometry(r * 0.34, 1), { matrix: trs(0, y, 0), color: PLATE, emissive: 0.9 });
}

function kernel(mb: MeshBuilder, r: number, y: number): void {
  const tube = r * 0.04;
  const rings: readonly (readonly [number, number, number, number])[] = [
    [r * 0.92, Math.PI / 2, 0, 0],
    [r * 0.7, 0, 0, 0],
    [r * 0.5, 0, 0, Math.PI / 2],
  ];
  for (const [radius, rx, ry, rz] of rings) {
    mb.add(new TorusGeometry(radius, tube, 6, 48), {
      matrix: trs(0, y, 0, rx, ry, rz),
      color: PLATE,
      flat: false,
      edges: 'none',
      emissive: 0.7,
    });
  }
  // Lattice struts between the middle and outer rings.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = r * 0.81;
    mb.add(new BoxGeometry(tube * 2, tube * 2, r * 0.24), {
      matrix: trs(Math.sin(a) * rr, y, Math.cos(a) * rr, 0, a, 0),
      color: BODY,
      emissive: 0.3,
    });
  }
  // Firewall blocks on the outer (horizontal) ring.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const rr = r * 0.92;
    mb.add(new BoxGeometry(r * 0.22, r * 0.16, r * 0.1), {
      matrix: trs(Math.sin(a) * rr, y, Math.cos(a) * rr, 0, a, 0),
      color: BODY,
      emissiveFn: (p) => (p.y > y + r * 0.06 ? 1 : 0.1),
    });
  }
  mb.add(new IcosahedronGeometry(r * 0.3, 1), { matrix: trs(0, y, 0), color: PLATE, emissive: 1 });
}

export function buildBossGeometry(id: BossId, theme: ThemeDef): BufferGeometry {
  const family = theme.geometry.enemyFamily;
  if (family !== 'platonic') {
    throw new Error(`buildBossGeometry: enemy family '${family}' is reserved for a future theme`);
  }
  const r = BOSS_DEFS[id].radius;
  const y = bossHoverY(id);
  const mb = new MeshBuilder();
  switch (id) {
    case 'forkBomb':
      forkBomb(mb, r, y);
      break;
    case 'raceCondition':
      raceCondition(mb, r, y);
      break;
    case 'kernel':
      kernel(mb, r, y);
      break;
  }
  return mb.build(`boss:${id}`);
}
