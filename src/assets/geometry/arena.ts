/**
 * Arena geometry: floor plane (the floor shader draws everything), the force-field wall band around
 * ARENA.RADIUS (uv.x around, uv.y 0 bottom .. 1 top), a hex pylon (placed at portals by ArenaScene), and the
 * inside-out sky sphere (drawn at the far plane by the sky shader). Also the pickup gem and shield dome.
 */
import {
  CylinderGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import { ARENA } from '../../config/tuning';
import type { ThemeDef } from '../../contracts/theme';
import { MeshBuilder } from './MeshBuilder';
import { trs } from './shapes';

export const FLOOR_SIZE = 200;
export const WALL_HEIGHT = 3;
export const PYLON_HEIGHT = 4;
export const SKY_RADIUS = 400;

export function buildArena(theme: ThemeDef): {
  floor: BufferGeometry;
  wall: BufferGeometry;
  pylon: BufferGeometry;
  sky: BufferGeometry;
} {
  const pal = theme.palette.sectors[0];
  const mb = new MeshBuilder();

  mb.add(new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, 1, 1), {
    matrix: trs(0, 0, 0, -Math.PI / 2, 0, 0),
    color: pal.floor,
    edges: 'none',
  });
  const floor = mb.build('arena:floor');

  mb.add(new CylinderGeometry(ARENA.RADIUS, ARENA.RADIUS, WALL_HEIGHT, 128, 1, true), {
    matrix: trs(0, WALL_HEIGHT / 2, 0),
    color: pal.accent,
    flat: false,
    edges: 'none',
    emissive: 1,
  });
  const wall = mb.build('arena:wall');

  mb.add(new CylinderGeometry(0.42, 0.6, PYLON_HEIGHT, 6, 1), {
    matrix: trs(0, PYLON_HEIGHT / 2, 0),
    color: 0x1c2233,
    emissiveFn: (p) => (p.y < 0.25 ? 0.8 : 0.05),
  });
  mb.add(new OctahedronGeometry(0.4, 0), {
    matrix: trs(0, PYLON_HEIGHT + 0.55, 0, 0, 0, 0, 1, 1.5, 1),
    color: 0x3a4560,
    emissive: 1,
  });
  mb.add(new TorusGeometry(0.75, 0.05, 4, 6), {
    matrix: trs(0, PYLON_HEIGHT * 0.7, 0, Math.PI / 2, 0, 0),
    color: 0x3a4560,
    emissive: 0.9,
    edges: 'none',
  });
  const pylon = mb.build('arena:pylon');

  mb.add(new SphereGeometry(SKY_RADIUS, 48, 24), {
    color: pal.sky,
    invert: true,
    flat: false,
    edges: 'none',
  });
  const sky = mb.build('arena:sky');

  return { floor, wall, pylon, sky };
}

/** Shard pickup gem (bipyramid) hovering at y about 0.6; value scales through the instance scale. */
export function buildPickupGeometry(): BufferGeometry {
  const mb = new MeshBuilder();
  mb.add(new OctahedronGeometry(0.3, 0), {
    matrix: trs(0, 0.6, 0, 0, 0, 0, 0.8, 1.3, 0.8),
    color: 0x3a4560,
    emissive: 0.8,
  });
  return mb.build('pickup');
}

/** Unit shield dome (hemisphere radius 1, y >= 0); uv.y = elevation fraction * 0.5 for the force field. */
export function buildShieldGeometry(): BufferGeometry {
  const dome = new SphereGeometry(1, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = dome.getAttribute('position');
  const uv = dome.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const y = Math.min(Math.max(pos.getY(i), 0), 1);
    uv.setY(i, (Math.asin(y) / (Math.PI / 2)) * 0.5);
  }
  const mb = new MeshBuilder();
  mb.add(dome, { color: 0x3a4560, flat: false, edges: 'none', emissive: 1 });
  return mb.build('shield');
}
