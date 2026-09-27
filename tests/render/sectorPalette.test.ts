/**
 * Sector palettes vs player identity colours (plan section 2: "Cyan and magenta team colours stay readable
 * against every sector palette"). Enemies and elites must never read as P1 cyan, P2 magenta or the colourblind
 * P2 orange, nor as the hot-orange enemy bullets; the wall accent must stay off the player hues too.
 */
import { describe, expect, it } from 'vitest';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';

/** HSV hue in degrees [0, 360). */
function hue(hex: number): number {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Enemies/elites vs the player colours and enemy bullets. */
const ENEMY_MIN_DEG = 40;
/** Wall accent vs the player colours. */
const WALL_MIN_DEG = 30;

describe('KERNEL PANIC sector palettes', () => {
  const pal = KERNEL_PANIC.palette;
  const players = [
    ['p1', pal.p1],
    ['p2', pal.p2],
    ['p2Colorblind', pal.p2Colorblind],
  ] as const;

  it(`enemy and elite hues stay >= ${String(ENEMY_MIN_DEG)} deg from every player colour and the enemy bullets`, () => {
    const clashes: string[] = [];
    pal.sectors.forEach((s, i) => {
      for (const [name, c] of [
        ['enemy', s.enemy],
        ['elite', s.elite],
      ] as const) {
        for (const [pn, pc] of [...players, ['enemyShot', pal.enemyShot] as const]) {
          const d = hueDist(c, pc);
          if (d < ENEMY_MIN_DEG) clashes.push(`sector${String(i + 1)}.${name}~${pn} (${d.toFixed(0)} deg)`);
        }
      }
    });
    expect(clashes).toEqual([]);
  });

  it(`wall accents stay >= ${String(WALL_MIN_DEG)} deg from every player colour`, () => {
    const clashes: string[] = [];
    pal.sectors.forEach((s, i) => {
      for (const [pn, pc] of players) {
        const d = hueDist(s.accent, pc);
        if (d < WALL_MIN_DEG) clashes.push(`sector${String(i + 1)}.accent~${pn} (${d.toFixed(0)} deg)`);
      }
    });
    expect(clashes).toEqual([]);
  });

  it('elites are distinct from the regular enemies of their sector', () => {
    for (const s of pal.sectors) expect(hueDist(s.enemy, s.elite)).toBeGreaterThanOrEqual(ENEMY_MIN_DEG);
  });

  it('enemy bullets stay hot orange/red', () => {
    const h = hue(pal.enemyShot);
    expect(h < 30 || h > 345).toBe(true);
  });
});
