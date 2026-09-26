/**
 * Seeded CPU noise (Boot-time asset generation only): 2D value noise, 3D simplex noise, 2D/3D FBM and a
 * periodic (tiling) 2D value noise for DataTextures. Deterministic per seed via core/rng.
 */
import { createRng } from '../core/rng';

export interface Noise {
  /** Smooth value noise in [0, 1]. */
  value2(x: number, y: number): number;
  /** Simplex noise in about [-1, 1]. */
  simplex3(x: number, y: number, z: number): number;
  /** Value-noise FBM normalised to [0, 1]. */
  fbm2(x: number, y: number, octaves: number): number;
  /** Simplex FBM normalised to about [-1, 1]. */
  fbm3(x: number, y: number, z: number, octaves: number): number;
  /** Value noise that tiles with integer period (px, py) in lattice units, in [0, 1]. */
  tile2(x: number, y: number, px: number, py: number): number;
  /** Deterministic lattice hash in [0, 1). */
  hash2(ix: number, iy: number): number;
}

const F3 = 1 / 3;
const G3 = 1 / 6;
const GRAD3: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function mod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

export function createNoise(seed: number): Noise {
  const rng = createRng(seed);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = base[i]!;
    base[i] = base[j]!;
    base[j] = t;
  }
  const perm = new Uint8Array(512);
  const values = new Float32Array(256);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;
  for (let i = 0; i < 256; i++) values[i] = rng.next();

  const hash2 = (ix: number, iy: number): number => values[perm[(perm[ix & 255]! + (iy & 255)) & 511]!]!;

  const lattice = (ix: number, iy: number, fx: number, fy: number): number => {
    const u = fade(fx);
    const v = fade(fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  const value2 = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    return lattice(ix, iy, x - ix, y - iy);
  };

  const tile2 = (x: number, y: number, px: number, py: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const x0 = mod(ix, px);
    const y0 = mod(iy, py);
    const x1 = mod(ix + 1, px);
    const y1 = mod(iy + 1, py);
    const a = hash2(x0, y0);
    const b = hash2(x1, y0);
    const c = hash2(x0, y1);
    const d = hash2(x1, y1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };

  const simplex3 = (x: number, y: number, z: number): number => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
    const corners: readonly (readonly [number, number, number, number, number, number])[] = [
      [x0, y0, z0, 0, 0, 0],
      [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, i1, j1, k1],
      [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, i2, j2, k2],
      [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, 1, 1, 1],
    ];
    let n = 0;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    for (const [cx, cy, cz, oi, oj, ok] of corners) {
      const tt = 0.6 - cx * cx - cy * cy - cz * cz;
      if (tt <= 0) continue;
      const gi = perm[ii + oi + perm[jj + oj + perm[kk + ok]!]!]! % 12;
      const g = GRAD3[gi]!;
      const t2 = tt * tt;
      n += t2 * t2 * (g[0] * cx + g[1] * cy + g[2] * cz);
    }
    return 32 * n;
  };

  const fbm2 = (x: number, y: number, octaves: number): number => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let o = 0; o < octaves; o++) {
      sum += amp * value2(fx, fy);
      norm += amp;
      fx = fx * 2.03 + 17.1;
      fy = fy * 2.03 + 9.2;
      amp *= 0.5;
    }
    return norm > 0 ? sum / norm : 0;
  };

  const fbm3 = (x: number, y: number, z: number, octaves: number): number => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fy = y;
    let fz = z;
    for (let o = 0; o < octaves; o++) {
      sum += amp * simplex3(fx, fy, fz);
      norm += amp;
      fx = fx * 2.01 + 11.3;
      fy = fy * 2.01 + 5.7;
      fz = fz * 2.01 + 3.1;
      amp *= 0.5;
    }
    return norm > 0 ? sum / norm : 0;
  };

  return { value2, simplex3, fbm2, fbm3, tile2, hash2 };
}
