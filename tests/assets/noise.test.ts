import { describe, expect, it } from 'vitest';
import { createNoise } from '../../src/assets/noise';
import {
  createHexMaskTexture,
  createNoiseTexture,
  createPaletteRamp,
  hexEdge,
} from '../../src/assets/textures';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';

function sample(seed: number): number[] {
  const n = createNoise(seed);
  const out: number[] = [];
  for (let i = 0; i < 64; i++) {
    const x = i * 0.37 - 5;
    const y = i * 0.71 + 2;
    out.push(n.value2(x, y), n.simplex3(x, y, i * 0.13), n.fbm2(x, y, 3), n.fbm3(x, y, 0.5, 3));
  }
  return out;
}

describe('createNoise', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(sample(1234)).toEqual(sample(1234));
    expect(sample(1234)).not.toEqual(sample(4321));
  });

  it('stays in range and is continuous', () => {
    const n = createNoise(99);
    let minS = Infinity;
    let maxS = -Infinity;
    for (let i = 0; i < 4000; i++) {
      const x = (i % 97) * 0.173 - 8;
      const y = Math.floor(i / 97) * 0.291 - 6;
      const v = n.value2(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const f = n.fbm2(x, y, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      const s = n.simplex3(x, y, i * 0.01);
      minS = Math.min(minS, s);
      maxS = Math.max(maxS, s);
      expect(Math.abs(n.value2(x + 1e-4, y) - v)).toBeLessThan(1e-2);
    }
    expect(minS).toBeGreaterThanOrEqual(-1.05);
    expect(maxS).toBeLessThanOrEqual(1.05);
    expect(maxS - minS).toBeGreaterThan(0.8);
    expect(n.fbm2(1, 2, 0)).toBe(0);
    expect(n.fbm3(1, 2, 3, 0)).toBe(0);
  });

  it('value noise interpolates the lattice hash at integer points', () => {
    const n = createNoise(5);
    expect(n.value2(3, 4)).toBeCloseTo(n.hash2(3, 4), 10);
    expect(n.value2(-3, -7)).toBeCloseTo(n.hash2(-3, -7), 10);
  });

  it('tile2 is periodic', () => {
    const n = createNoise(77);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.61;
      const y = i * 0.29;
      expect(n.tile2(x, y, 8, 16)).toBeCloseTo(n.tile2(x + 8, y + 16, 8, 16), 10);
      expect(n.tile2(x, y, 8, 16)).toBeCloseTo(n.tile2(x - 16, y - 32, 8, 16), 10);
    }
  });
});

describe('DataTextures', () => {
  it('noise texture is 256^2 RGBA, tiling, deterministic', () => {
    const a = createNoiseTexture(createNoise(3), 64);
    const b = createNoiseTexture(createNoise(3), 64);
    expect(a.image.width).toBe(64);
    expect(a.wrapS).toBe(RepeatWrapping);
    expect(a.colorSpace).toBe(NoColorSpace);
    expect(a.generateMipmaps).toBe(true);
    const da = a.image.data as Uint8Array;
    expect(Array.from(da)).toEqual(Array.from(b.image.data as Uint8Array));
    // Tiling: the fbm channel changes smoothly across the wrap seam (left vs right column).
    let seam = 0;
    let interior = 0;
    for (let y = 0; y < 64; y++) {
      seam += Math.abs(da[(y * 64 + 63) * 4]! - da[y * 64 * 4]!);
      interior += Math.abs(da[(y * 64 + 31) * 4]! - da[(y * 64 + 32) * 4]!);
    }
    expect(seam).toBeLessThan(interior * 3 + 64 * 8);
    expect(createNoiseTexture(createNoise(3)).image.width).toBe(256);
  });

  it('hex mask marks edges and tiles', () => {
    const t = createHexMaskTexture(createNoise(1));
    expect(t.image.width).toBe(64);
    const d = t.image.data as Uint8Array;
    let edges = 0;
    for (let i = 0; i < 64 * 64; i++) if (d[i * 4]! > 128) edges++;
    expect(edges).toBeGreaterThan(64);
    expect(edges).toBeLessThan(64 * 64 * 0.6);
    const h = { edge: 0, cx: 0, cy: 0 };
    hexEdge(0, 0, h);
    expect(h.edge).toBeCloseTo(0.5, 5);
    hexEdge(0.5, 0, h);
    expect(h.edge).toBeCloseTo(0, 5);
  });

  it('palette ramp runs from the floor colour to white in sRGB', () => {
    const t = createPaletteRamp(KERNEL_PANIC);
    expect(t.colorSpace).toBe(SRGBColorSpace);
    expect(t.image.height).toBe(1);
    const d = t.image.data as Uint8Array;
    const floor = KERNEL_PANIC.palette.sectors[0].floor;
    expect([d[0], d[1], d[2]]).toEqual([(floor >> 16) & 255, (floor >> 8) & 255, floor & 255]);
    expect([d[255 * 4], d[255 * 4 + 1], d[255 * 4 + 2]]).toEqual([255, 255, 255]);
  });
});
