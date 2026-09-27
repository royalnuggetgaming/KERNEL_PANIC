import { describe, expect, it } from 'vitest';
import {
  buildVoxelText,
  countVoxels,
  FONT_5X7,
  GLYPH_ADVANCE,
  GLYPH_H,
  GLYPH_W,
  glyphFor,
  VOXEL_SIZE,
} from '../../src/assets/geometry/voxelFont';
import { THEMES } from '../../src/themes/registry';
import { boundsOf, checkGeometry } from './geometryChecks';

describe('5x7 voxel font', () => {
  it('every glyph has 7 rows of 5 pixels', () => {
    for (const [ch, g] of Object.entries(FONT_5X7)) {
      expect(g, ch).toHaveLength(GLYPH_H);
      for (const row of g) expect(row, ch).toMatch(/^[#.]{5}$/);
    }
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') expect(FONT_5X7[c], c).toBeDefined();
  });

  it('maps lowercase to uppercase and unknown characters to ?', () => {
    expect(glyphFor('k')).toBe(FONT_5X7.K);
    expect(glyphFor('~')).toBe(FONT_5X7['?']);
  });

  it('builds one 12-triangle voxel per lit pixel, centred on the origin', () => {
    for (const theme of Object.values(THEMES)) {
      const g = buildVoxelText(theme.title);
      checkGeometry(g);
      expect(g.getAttribute('position').count).toBe(countVoxels(theme.title) * 36);
      const b = boundsOf(g);
      const width = (theme.title.length * GLYPH_ADVANCE - 1) * VOXEL_SIZE;
      expect(b.max.x - b.min.x).toBeLessThanOrEqual(width + 1e-6);
      expect(b.max.x - b.min.x).toBeGreaterThan(width - 2 * VOXEL_SIZE);
      expect(b.min.x).toBeCloseTo(-b.max.x, 5);
      expect(b.max.y - b.min.y).toBeLessThanOrEqual(GLYPH_H * VOXEL_SIZE);
      // Front faces glow, the rest barely.
      const e = g.getAttribute('aEmissive');
      let lit = 0;
      for (let i = 0; i < e.count; i++) if (e.getX(i) > 0.5) lit++;
      expect(lit).toBe(countVoxels(theme.title) * 6);
    }
  });

  it('blank text still yields a valid geometry', () => {
    const g = buildVoxelText('   ');
    checkGeometry(g);
    expect(countVoxels('   ')).toBe(0);
    expect(GLYPH_W).toBe(5);
  });
});
