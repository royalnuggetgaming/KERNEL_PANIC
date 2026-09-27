/**
 * Procedural DataTextures, generated once at Boot:
 * - noise: 256^2 RGBA tiling noise (r = 3-octave tiling FBM, g = single tiling value octave, b = white hash,
 *   a = tiling cellular F1), repeat wrap, mipmapped, linear data (NoColorSpace). Bound to uNoiseTex.
 * - hexMask: 64^2 RGBA tiling hex mask (r = edge line, g = cell hash, b = centre distance), repeat wrap.
 * - paletteRamp: 1x256 sRGB ramp through the theme's sector-1 colours, clamp wrap, no mipmaps.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import type { ThemeDef } from '../contracts/theme';
import type { Noise } from './noise';

export const NOISE_TEX_SIZE = 256;
export const HEX_TEX_SIZE = 64;
export const RAMP_TEX_SIZE = 256;

function toByte(v: number): number {
  const c = Math.round(v * 255);
  return c < 0 ? 0 : c > 255 ? 255 : c;
}

function finish(tex: DataTexture, name: string, mipmaps: boolean): DataTexture {
  tex.name = name;
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Tiling cellular noise F1 in [0, ~1] with an integer cell period. */
function tilingCellular(noise: Noise, x: number, y: number, period: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 8;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const ox = noise.hash2(wx, wy + 1000);
      const oy = noise.hash2(wx + 1000, wy);
      const dx = cx + ox - x;
      const dy = cy + oy - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export function createNoiseTexture(noise: Noise, size = NOISE_TEX_SIZE): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let fbm = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < 3; o++) {
        const period = 8 << o;
        fbm += amp * noise.tile2(u * period, v * period, period, period);
        norm += amp;
        amp *= 0.5;
      }
      const i = (y * size + x) * 4;
      data[i] = toByte(fbm / norm);
      data[i + 1] = toByte(noise.tile2(u * 32, v * 32, 32, 32));
      data[i + 2] = toByte(noise.hash2(x, y));
      data[i + 3] = toByte(tilingCellular(noise, u * 16, v * 16, 16));
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = NoColorSpace;
  return finish(tex, 'tex:noise', true);
}

/** Distance to the nearest edge of a hex lattice with periods (1, sqrt 3) and the containing cell centre. */
export function hexEdge(px: number, py: number, out: { edge: number; cx: number; cy: number }): void {
  const sx = 1;
  const sy = Math.sqrt(3);
  const ax = Math.floor(px / sx) + 0.5;
  const ay = Math.floor(py / sy) + 0.5;
  const bx = Math.floor((px - 0.5) / sx) + 0.5;
  const by = Math.floor((py - 1) / sy) + 0.5;
  const h1x = px - ax * sx;
  const h1y = py - ay * sy;
  const h2x = px - (bx + 0.5) * sx;
  const h2y = py - (by + 0.5) * sy;
  let hx: number, hy: number;
  if (h1x * h1x + h1y * h1y < h2x * h2x + h2y * h2y) {
    hx = h1x;
    hy = h1y;
    out.cx = ax;
    out.cy = ay;
  } else {
    hx = h2x;
    hy = h2y;
    out.cx = bx + 0.5;
    out.cy = by + 0.5;
  }
  const qx = Math.abs(hx);
  const qy = Math.abs(hy);
  out.edge = 0.5 - Math.max(qx * sx * 0.5 + qy * sy * 0.5, qx);
}

export function createHexMaskTexture(noise: Noise, size = HEX_TEX_SIZE): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const h = { edge: 0, cx: 0, cy: 0 };
  const sy = Math.sqrt(3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 4 x 2 hex periods per texture: tiles exactly (slightly anisotropic texels).
      hexEdge(((x + 0.5) / size) * 4, ((y + 0.5) / size) * 2 * sy, h);
      const i = (y * size + x) * 4;
      data[i] = toByte(1 - Math.min(h.edge / 0.08, 1));
      data[i + 1] = toByte(noise.hash2(Math.floor(h.cx * 2) & 255, Math.floor(h.cy * 2) & 255));
      data[i + 2] = toByte(1 - h.edge * 2);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = NoColorSpace;
  return finish(tex, 'tex:hexMask', true);
}

export function createPaletteRamp(theme: ThemeDef, size = RAMP_TEX_SIZE): DataTexture {
  const s = theme.palette.sectors[0];
  const stops = [s.floor, s.sky, s.grid, s.accent, 0xffffff];
  const data = new Uint8Array(size * 4);
  for (let x = 0; x < size; x++) {
    const t = (x / (size - 1)) * (stops.length - 1);
    const k = Math.min(Math.floor(t), stops.length - 2);
    const f = t - k;
    // Interpolate in sRGB byte space: the texture is tagged SRGBColorSpace.
    const i = x * 4;
    const ar = (stops[k]! >> 16) & 255;
    const ag = (stops[k]! >> 8) & 255;
    const ab = stops[k]! & 255;
    const br = (stops[k + 1]! >> 16) & 255;
    const bg = (stops[k + 1]! >> 8) & 255;
    const bb = stops[k + 1]! & 255;
    data[i] = Math.round(ar + (br - ar) * f);
    data[i + 1] = Math.round(ag + (bg - ag) * f);
    data[i + 2] = Math.round(ab + (bb - ab) * f);
    data[i + 3] = 255;
  }
  const tex = new DataTexture(data, size, 1, RGBAFormat, UnsignedByteType);
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.colorSpace = SRGBColorSpace;
  return finish(tex, 'tex:paletteRamp', false);
}
