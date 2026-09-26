/**
 * In-code 5x7 bitmap font and the voxel text mesh built from it (title logo). One bevelled cube per lit pixel
 * with a glowing front face; text is centred on the origin in the XY plane, facing +Z. Lowercase maps to
 * uppercase; unsupported characters render as '?'.
 */
import { BoxGeometry, type BufferGeometry } from 'three';
import { MeshBuilder } from './MeshBuilder';
import { trs } from './shapes';

export const GLYPH_W = 5;
export const GLYPH_H = 7;
/** World size of one voxel (u). */
export const VOXEL_SIZE = 0.25;
/** Horizontal advance per character, in voxels (glyph + 1 column spacing). */
export const GLYPH_ADVANCE = GLYPH_W + 1;

type Glyph = readonly [string, string, string, string, string, string, string];

export const FONT_5X7: Readonly<Record<string, Glyph>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
};

export function glyphFor(ch: string): Glyph {
  return FONT_5X7[ch.toUpperCase()] ?? FONT_5X7['?']!;
}

/** Number of lit pixels the text will produce (voxel count). */
export function countVoxels(text: string): number {
  let n = 0;
  for (const ch of text) {
    for (const row of glyphFor(ch)) for (const c of row) if (c === '#') n++;
  }
  return n;
}

export function buildVoxelText(text: string): BufferGeometry {
  const mb = new MeshBuilder();
  const chars = Array.from(text);
  const v = VOXEL_SIZE;
  const depth = v * 1.6;
  const widthVox = Math.max(chars.length * GLYPH_ADVANCE - 1, 1);
  const x0 = (-widthVox * v) / 2 + v / 2;
  const y0 = ((GLYPH_H - 1) * v) / 2;
  const front = depth / 2 - 1e-3;
  for (let ci = 0; ci < chars.length; ci++) {
    const glyph = glyphFor(chars[ci]!);
    for (let row = 0; row < GLYPH_H; row++) {
      const line = glyph[row] as string;
      for (let col = 0; col < GLYPH_W; col++) {
        if (line.charAt(col) !== '#') continue;
        const x = x0 + (ci * GLYPH_ADVANCE + col) * v;
        const y = y0 - row * v;
        mb.add(new BoxGeometry(v * 0.9, v * 0.9, depth), {
          matrix: trs(x, y, 0),
          color: 0x2c3448,
          emissiveFn: (p) => (p.z > front ? 0.9 : 0.12),
        });
      }
    }
  }
  if (mb.triangleCount === 0) {
    // Empty/blank text still yields a valid (degenerate-free) geometry: a single hidden-edge base plate.
    mb.add(new BoxGeometry(v, v * 0.1, v), { color: 0x2c3448, edges: 'none' });
  }
  return mb.build(`voxelText:${text}`);
}
