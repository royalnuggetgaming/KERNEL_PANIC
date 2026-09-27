/**
 * VISUAL critic reproductions (FAIL on current code).
 *
 * VISUAL-1: `.kp-ui button` (specificity 0,1,1) in ui/styles/base.css resets padding/border/color/font/text-align
 * and beats every single-class component rule (0,1,0) applied to <button> elements: .kp-menu-item (dim colour,
 * padding, cursor border), .kp-row-buy, .kp-row-lock (the "55LOCK" glue), .kp-btn, .kp-shop-ready, ...
 *
 * VISUAL-2: the Offline ghost is clamped to viewRectOnGround(), which spans the FULL NDC box (+/-1), not the
 * framing safe box (x +/-0.82, y -0.78..0.72) that keeps content clear of the HUD panels and the top banner, so
 * the ghost can sit under the bottom HUD panels (screenshot round1/visual/23-offline-b-1512x982.png).
 *
 * VISUAL-3: ArenaScene draws ONE pylon mesh at the arena origin; arena.ts documents pylons "placed at portals"
 * (tuning PORTALS = 8 at PORTAL_RADIUS 30).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMERA, ARENA } from '../../../src/config/tuning';
import { projectToNdc, viewRectOnGround } from '../../../src/render/cameraMath';
import { KERNEL_PANIC } from '../../../src/themes/kernelPanic';

const css = (f: string): string => readFileSync(new URL(`../../../src/ui/styles/${f}`, import.meta.url), 'utf8');

describe('VISUAL-1 button reset specificity', () => {
  it('the global button reset must not out-rank component classes (wrap it in :where())', () => {
    const base = css('base.css');
    // A bare `.kp-ui button {` selector beats `.kp-row-lock {`, `.kp-menu-item {`, `.kp-btn {` ...
    expect(base).not.toMatch(/^\.kp-ui button\s*\{/m);
  });
});

describe('VISUAL-2 ghost clamp rectangle vs HUD safe box', () => {
  it('every corner of the ghost clamp rect (inset) projects inside the framing safe box', () => {
    const pose = { targetX: 0, targetZ: 0, distance: 40 };
    const aspect = 1512 / 982;
    const r = viewRectOnGround(pose, aspect, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    const inset = CAMERA.GHOST_INSET;
    const out = { x: 0, y: 0 };
    // Bottom-right corner: where the ghost ended up under the P2 HUD panel.
    projectToNdc(pose, aspect, r.maxX - inset, r.maxZ - inset, out);
    expect(out.y).toBeGreaterThanOrEqual(CAMERA.SAFE_Y_MIN);
  });
});

describe('VISUAL-3 pylons at portals', () => {
  it('ArenaScene places a pylon per portal instead of one at the origin', () => {
    const src = readFileSync(new URL('../../../src/render/scenes/ArenaScene.ts', import.meta.url), 'utf8');
    expect(ARENA.PORTALS).toBeGreaterThan(1);
    expect(src).toMatch(/PORTAL/);
  });
});

/**
 * VISUAL-4: sector palettes reuse the player identity colours. Sector 3 elite 0x39ffec is ~P1 cyan 0x19e6ff,
 * sector 3 enemy 0xff9df2 is ~P2 magenta 0xff3fd0 (and P2 shots), sector 2 wall accent 0xc05cff is magenta,
 * sector 1 wall accent === P1. Screenshots: round1/visual/19-wave13, 20-boss15-c, 17-wave9-b.
 */
const hue = (hex: number): number => {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};
const hueDist = (a: number, b: number): number => {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
};

describe('VISUAL-4 enemy colours stay distinct from player colours', () => {
  it('no sector enemy/elite hue within 25 deg of P1 or P2', () => {
    const pal = KERNEL_PANIC.palette;
    const clashes: string[] = [];
    pal.sectors.forEach((s, i) => {
      for (const [name, c] of [
        ['enemy', s.enemy],
        ['elite', s.elite],
      ] as const) {
        for (const [pn, pc] of [
          ['p1', pal.p1],
          ['p2', pal.p2],
        ] as const) {
          if (hueDist(c, pc) < 25) clashes.push(`sector${String(i + 1)}.${name}~${pn}`);
        }
      }
    });
    expect(clashes).toEqual([]);
  });
});
