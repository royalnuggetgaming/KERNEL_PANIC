import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { SpatialGrid } from '../../src/core/SpatialGrid';

const grid = (): SpatialGrid =>
  new SpatialGrid({ cols: 16, rows: 16, cellSize: 4, originX: -32, originZ: -32, capacity: 256 });

describe('SpatialGrid', () => {
  it('queryCircle equals brute force on 1,000 random layouts', () => {
    const g = grid();
    const rng = createRng(77);
    const out = new Int32Array(256);
    for (let layout = 0; layout < 1000; layout++) {
      const n = rng.int(0, 180);
      const xs: number[] = [];
      const zs: number[] = [];
      const rs: number[] = [];
      g.begin();
      for (let i = 0; i < n; i++) {
        // Some items outside the grid to exercise border clamping.
        const x = rng.range(-40, 40);
        const z = rng.range(-40, 40);
        const r = rng.range(0.3, 3.5);
        xs.push(x);
        zs.push(z);
        rs.push(r);
        g.add(i, x, z, r);
      }
      g.build();
      const qx = rng.range(-36, 36);
      const qz = rng.range(-36, 36);
      const qr = rng.range(0, 10);
      const k = g.queryCircle(qx, qz, qr, out);
      const got = Array.from(out.subarray(0, k)).sort((a, b) => a - b);
      const want: number[] = [];
      for (let i = 0; i < n; i++) {
        const dx = xs[i]! - qx;
        const dz = zs[i]! - qz;
        const rr = qr + rs[i]!;
        if (dx * dx + dz * dz <= rr * rr) want.push(i);
      }
      expect(got).toEqual(want);
    }
  });

  it('queryAabb returns every overlapping item once', () => {
    const g = grid();
    const rng = createRng(5);
    const out = new Int32Array(256);
    for (let layout = 0; layout < 200; layout++) {
      g.begin();
      const items: [number, number, number][] = [];
      for (let i = 0; i < 100; i++) {
        const it: [number, number, number] = [rng.range(-32, 32), rng.range(-32, 32), rng.range(0.2, 2)];
        items.push(it);
        g.add(i, it[0], it[1], it[2]);
      }
      g.build();
      const x0 = rng.range(-30, 20);
      const z0 = rng.range(-30, 20);
      const x1 = x0 + rng.range(0, 12);
      const z1 = z0 + rng.range(0, 12);
      const k = g.queryAabb(x0, z0, x1, z1, out);
      const got = Array.from(out.subarray(0, k)).sort((a, b) => a - b);
      expect(new Set(got).size).toBe(got.length);
      const want = items
        .map(([x, z, r], i) => (x + r < x0 || x - r > x1 || z + r < z0 || z - r > z1 ? -1 : i))
        .filter((i) => i >= 0);
      expect(got).toEqual(want);
    }
  });

  it('respects the out buffer length and the item capacity', () => {
    const g = new SpatialGrid({ cols: 4, rows: 4, cellSize: 4, originX: -8, originZ: -8, capacity: 3 });
    g.begin();
    for (let i = 0; i < 5; i++) g.add(i, 0, 0, 1);
    g.build();
    expect(g.count).toBe(3);
    expect(g.overflow).toBe(2);
    const small = new Int32Array(2);
    expect(g.queryCircle(0, 0, 5, small)).toBe(2);
    expect(g.queryAabb(-1, -1, 1, 1, small)).toBe(2);
  });

  it('maps NaN positions to a valid cell instead of corrupting the build', () => {
    const g = grid();
    g.begin();
    g.add(1, Number.NaN, 0, 1);
    g.add(2, 0, 0, 1);
    g.build();
    const out = new Int32Array(8);
    expect(Array.from(out.subarray(0, g.queryCircle(0, 0, 1, out)))).toEqual([2]);
  });
});
