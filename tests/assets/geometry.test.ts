import { BoxGeometry, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildArena,
  buildPickupGeometry,
  buildShieldGeometry,
  FLOOR_SIZE,
  PYLON_RADIUS,
  SKY_RADIUS,
  WALL_HEIGHT,
} from '../../src/assets/geometry/arena';
import { bossHoverY, buildBossGeometry } from '../../src/assets/geometry/bosses';
import { buildEnemyGeometry, enemyHoverY } from '../../src/assets/geometry/enemies';
import { buildFxShapes, buildTrailGeometry, TRAIL_SEGMENTS } from '../../src/assets/geometry/fxShapes';
import { MeshBuilder } from '../../src/assets/geometry/MeshBuilder';
import { buildVehicleGeometry, SLED_BELLY_Y } from '../../src/assets/geometry/vehicles';
import { BOSS_DEFS } from '../../src/config/bosses';
import { ENEMY_DEFS } from '../../src/config/enemies';
import { ARENA } from '../../src/config/tuning';
import { BOSS_IDS, ENEMY_KINDS, VEHICLE_IDS } from '../../src/contracts/ids';
import type { ThemeDef } from '../../src/contracts/theme';
import { THEMES } from '../../src/themes/registry';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import {
  boundsOf,
  checkGeometry,
  maxDistanceFrom,
  outwardFraction,
  visibleEdgeFraction,
} from './geometryChecks';

const ALL_THEMES: readonly ThemeDef[] = Object.values(THEMES);

describe('MeshBuilder', () => {
  it('merges parts into one non-indexed geometry with every attribute', () => {
    const mb = new MeshBuilder();
    mb.add(new BoxGeometry(1, 1, 1), { color: 0xffffff, emissive: 0.5 });
    mb.add(new BoxGeometry(1, 1, 1), { matrix: new Matrix4().makeTranslation(2, 0, 0) });
    expect(mb.triangleCount).toBe(24);
    const g = mb.build('test');
    checkGeometry(g);
    expect(g.getAttribute('position').count).toBe(72);
    expect(mb.vertexCount).toBe(0);
  });

  it('hides coplanar diagonals in feature mode and keeps them in all mode', () => {
    const mb = new MeshBuilder();
    mb.add(new BoxGeometry(1, 1, 1));
    const feature = mb.build('f');
    // 12 triangles x 3 edges = 36 components; each face's diagonal (2 per face) is hidden.
    expect(visibleEdgeFraction(feature)).toBeCloseTo(24 / 36, 5);
    mb.add(new BoxGeometry(1, 1, 1), { edges: 'all' });
    expect(visibleEdgeFraction(mb.build('a'))).toBe(1);
    mb.add(new BoxGeometry(1, 1, 1), { edges: 'none' });
    expect(visibleEdgeFraction(mb.build('n'))).toBe(0);
  });

  it('keeps outward winding when mirrored and reverses it when inverted', () => {
    const mb = new MeshBuilder();
    mb.addMirroredX(new BoxGeometry(1, 1, 1), { matrix: new Matrix4().makeTranslation(2, 0, 0) });
    const g = mb.build('mirror');
    checkGeometry(g);
    const b = boundsOf(g);
    expect(b.min.x).toBeCloseTo(-2.5, 5);
    expect(b.max.x).toBeCloseTo(2.5, 5);
    // Each box is convex: test outwardness per half around its own centre.
    mb.add(new BoxGeometry(1, 1, 1), { matrix: new Matrix4().makeScale(-1, 1, 1) });
    expect(outwardFraction(mb.build('neg'), new Vector3())).toBe(1);
    mb.add(new BoxGeometry(1, 1, 1), { invert: true });
    expect(outwardFraction(mb.build('inv'), new Vector3())).toBe(0);
  });

  it('clamps emissive from emissiveFn and skips degenerate triangles', () => {
    const mb = new MeshBuilder();
    mb.addTriangles([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0], {
      emissiveFn: (p) => p.y * 5 - 1,
    });
    const g = mb.build('clamp');
    expect(g.getAttribute('position').count).toBe(3);
    const e = g.getAttribute('aEmissive');
    expect([e.getX(0), e.getX(1), e.getX(2)]).toEqual([0, 0, 1]);
  });

  it('rejects a geometry without positions', () => {
    const mb = new MeshBuilder();
    const empty = new BoxGeometry(1, 1, 1);
    empty.deleteAttribute('position');
    expect(() => mb.add(empty)).toThrow(/position/);
  });
});

describe.each(ALL_THEMES.map((t) => [t.id, t] as const))('theme %s geometry', (_id, theme) => {
  it.each(VEHICLE_IDS)('vehicle %s is a valid sled within the craft footprint', (id) => {
    const g = buildVehicleGeometry(id, theme);
    checkGeometry(g);
    const b = boundsOf(g);
    expect(b.min.y).toBeGreaterThanOrEqual(SLED_BELLY_Y - 1e-6);
    expect(b.max.y).toBeLessThan(1.2);
    expect(Math.max(-b.min.x, b.max.x)).toBeLessThanOrEqual(1.05);
    expect(b.max.z).toBeLessThanOrEqual(1.25);
    expect(b.min.z).toBeGreaterThanOrEqual(-1.25);
    // Mirrored hull: symmetric about x = 0.
    expect(b.min.x).toBeCloseTo(-b.max.x, 5);
    // Nose points forward (+Z).
    expect(b.max.z).toBeGreaterThan(-b.min.z - 0.3);
    expect(g.getAttribute('position').count / 3).toBeLessThan(2000);
  });

  it.each(ENEMY_KINDS)('enemy %s fits its collision radius at hover height', (kind) => {
    const g = buildEnemyGeometry(kind, theme);
    checkGeometry(g);
    const r = ENEMY_DEFS[kind].radius;
    const centre = new Vector3(0, enemyHoverY(kind), 0);
    expect(maxDistanceFrom(g, centre)).toBeLessThanOrEqual(r * 1.05);
    expect(maxDistanceFrom(g, centre)).toBeGreaterThan(r * 0.6);
    expect(boundsOf(g).min.y).toBeGreaterThan(0);
    // A torus has an inward-facing inner half, so the winding check applies to the solids only.
    if (kind !== 'leech') expect(outwardFraction(g, centre)).toBeGreaterThan(0.75);
  });

  it.each(BOSS_IDS)('boss %s fits its radius', (id) => {
    const g = buildBossGeometry(id, theme);
    checkGeometry(g);
    const r = BOSS_DEFS[id].radius;
    const centre = new Vector3(0, bossHoverY(id), 0);
    expect(maxDistanceFrom(g, centre)).toBeLessThanOrEqual(r * 1.1);
    expect(maxDistanceFrom(g, centre)).toBeGreaterThan(r * 0.8);
    expect(boundsOf(g).min.y).toBeGreaterThan(0);
  });

  it('arena floor, wall, pylon and sky have the expected extents', () => {
    const { floor, wall, pylon, sky } = buildArena(theme);
    for (const g of [floor, wall, pylon, sky]) checkGeometry(g);
    const fb = boundsOf(floor);
    expect(fb.max.x - fb.min.x).toBeCloseTo(FLOOR_SIZE, 3);
    expect(fb.max.y).toBeCloseTo(0, 6);
    expect(floor.getAttribute('normal').getY(0)).toBeCloseTo(1, 6);
    const wb = boundsOf(wall);
    expect(wb.max.x).toBeCloseTo(ARENA.RADIUS, 3);
    expect(wb.min.y).toBeCloseTo(0, 6);
    expect(wb.max.y).toBeCloseTo(WALL_HEIGHT, 6);
    expect(maxDistanceFrom(sky, new Vector3())).toBeCloseTo(SKY_RADIUS, 0);
    // Inside-out sky: normals point towards the centre.
    expect(outwardFraction(sky, new Vector3())).toBeLessThan(0.01);
    expect(boundsOf(pylon).min.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it('stands one pylon behind every portal and none at the arena centre (VISUAL-2)', () => {
    const { pylon } = buildArena(theme);
    const pos = pylon.getAttribute('position');
    const n = ARENA.PORTALS;
    const count = new Array<number>(n).fill(0);
    const sx = new Array<number>(n).fill(0);
    const sz = new Array<number>(n).fill(0);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Every vertex belongs to a pylon between the portal ring and the wall (none at the centre).
      expect(Math.hypot(x, z)).toBeGreaterThan(ARENA.PORTAL_RADIUS - 1.5);
      expect(Math.hypot(x, z)).toBeLessThan(ARENA.RADIUS);
      // Portal i sits at yaw i * TAU / PORTALS (sim/formations.ts).
      const k = (Math.round((Math.atan2(x, z) / (Math.PI * 2)) * n) + n) % n;
      count[k]!++;
      sx[k]! += x;
      sz[k]! += z;
    }
    for (let k = 0; k < n; k++) {
      expect(count[k]).toBe(count[0]);
      const yaw = (k * Math.PI * 2) / n;
      expect(sx[k]! / count[k]!).toBeCloseTo(Math.sin(yaw) * PYLON_RADIUS, 0);
      expect(sz[k]! / count[k]!).toBeCloseTo(Math.cos(yaw) * PYLON_RADIUS, 0);
    }
    expect(count[0]).toBeGreaterThan(0);
  });
});

describe('theme-independent geometry', () => {
  it('pickup gem and shield dome', () => {
    const pickup = buildPickupGeometry();
    checkGeometry(pickup);
    expect(maxDistanceFrom(pickup, new Vector3(0, 0.6, 0))).toBeLessThan(0.45);
    const shield = buildShieldGeometry();
    checkGeometry(shield);
    const b = boundsOf(shield);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(b.max.y).toBeCloseTo(1, 3);
    const uv = shield.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(uv.getY(i)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it('fx shapes have their documented extents', () => {
    const fx = buildFxShapes();
    checkGeometry(fx.quad);
    checkGeometry(fx.ring);
    checkGeometry(fx.capsule);
    checkGeometry(fx.fullscreen);
    const q = boundsOf(fx.quad);
    expect([q.min.x, q.max.x, q.min.y, q.max.y]).toEqual([-0.5, 0.5, -0.5, 0.5]);
    const c = boundsOf(fx.capsule);
    expect([c.min.x, c.max.x, c.min.y, c.max.y]).toEqual([-1, 1, -1, 1]);
    expect(maxDistanceFrom(fx.ring, new Vector3())).toBeCloseTo(1, 5);
    expect(fx.fullscreen.getAttribute('position').count).toBe(3);
  });

  it('trail ribbons are indexed, dynamic and tinted per player', () => {
    for (const p of [0, 1] as const) {
      const g = buildTrailGeometry(p);
      checkGeometry(g, { indexed: true });
      expect(g.getAttribute('position').count).toBe((TRAIL_SEGMENTS + 1) * 2);
      expect(g.index!.count).toBe(TRAIL_SEGMENTS * 6);
      expect(g.getAttribute('aTint').getX(0)).toBe(p);
      const uv = g.getAttribute('uv');
      expect(uv.getX(0)).toBe(0);
      expect(uv.getX(uv.count - 1)).toBe(1);
    }
  });

  it('theme hooks reject reserved families', () => {
    const sub: ThemeDef = {
      ...KERNEL_PANIC,
      geometry: { ...KERNEL_PANIC.geometry, hullStyle: 'sub', enemyFamily: 'organic' },
    };
    expect(() => buildVehicleGeometry('lancer', sub)).toThrow(/reserved/);
    expect(() => buildEnemyGeometry('shard', sub)).toThrow(/reserved/);
    expect(() => buildBossGeometry('kernel', sub)).toThrow(/reserved/);
  });

  it.each(Object.values(THEMES))('builds every hull, enemy and boss mesh for $id', (theme) => {
    const all = [
      ...VEHICLE_IDS.map((v) => buildVehicleGeometry(v, theme)),
      ...ENEMY_KINDS.map((k) => buildEnemyGeometry(k, theme)),
      ...BOSS_IDS.map((b) => buildBossGeometry(b, theme)),
    ];
    for (const g of all) {
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      expect(g.getAttribute('aEmissive')).toBeDefined();
      g.dispose();
    }
  });
});
