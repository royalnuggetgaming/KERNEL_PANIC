/**
 * FX base shapes (instanced by batches/rings; shaders place and orient them):
 * - quad: 1x1 in the XY plane, [-0.5, 0.5] (particles, digits, decals, beams, shockwaves, markers)
 * - ring: flat annulus in the XY plane, inner 0.8 / outer 1 (dash/special rings)
 * - capsule: 2x2 quad in the XY plane, [-1, 1] (x across, y along) for capsule SDF projectiles
 * - fullscreen: one oversized clip-space triangle (post passes)
 * - trail ribbons: TRAIL_SEGMENTS segments, indexed, dynamic positions written by TrailRenderer
 */
import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import type { PlayerIndex } from '../../contracts/ids';
import { TINT } from '../../shaders/tints';
import { MeshBuilder } from './MeshBuilder';

export const TRAIL_SEGMENTS = 64;

export function buildFxShapes(): {
  quad: BufferGeometry;
  ring: BufferGeometry;
  capsule: BufferGeometry;
  fullscreen: BufferGeometry;
} {
  const mb = new MeshBuilder();
  mb.add(new PlaneGeometry(1, 1), { color: 0xffffff, edges: 'none', emissive: 1 });
  const quad = mb.build('fx:quad');
  mb.add(new RingGeometry(0.8, 1, 48, 1), { color: 0xffffff, edges: 'none', emissive: 1 });
  const ring = mb.build('fx:ring');
  mb.add(new PlaneGeometry(2, 2), { color: 0xffffff, edges: 'none', emissive: 1 });
  const capsule = mb.build('fx:capsule');
  return { quad, ring, capsule, fullscreen: buildFullscreenTriangle() };
}

export function buildFullscreenTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.name = 'fx:fullscreen';
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  g.setAttribute('color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.setAttribute('aBary', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  g.setAttribute('aEmissive', new Float32BufferAttribute([0, 0, 0], 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Trail ribbon for player p: 2 * (TRAIL_SEGMENTS + 1) vertices, vertex 2i / 2i+1 = left / right edge of
 * station i (i = 0 at the head). position (world space, DynamicDrawUsage) is rewritten by TrailRenderer;
 * uv.x = i / TRAIL_SEGMENTS, uv.y = 0 / 1; aTint = the player's tint slot.
 */
export function buildTrailGeometry(p: PlayerIndex): BufferGeometry {
  const stations = TRAIL_SEGMENTS + 1;
  const n = stations * 2;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3).fill(1);
  const bary = new Float32Array(n * 3).fill(1);
  const emi = new Float32Array(n).fill(1);
  const tint = new Float32Array(n).fill(p === 0 ? TINT.P1 : TINT.P2);
  for (let i = 0; i < stations; i++) {
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s;
      pos[v * 3] = s === 0 ? -0.2 : 0.2;
      pos[v * 3 + 1] = 0.3;
      pos[v * 3 + 2] = -i * 0.1;
      nrm[v * 3 + 1] = 1;
      uv[v * 2] = i / TRAIL_SEGMENTS;
      uv[v * 2 + 1] = s;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < TRAIL_SEGMENTS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.name = `fx:trail:${String(p)}`;
  const position = new Float32BufferAttribute(pos, 3);
  position.setUsage(DynamicDrawUsage);
  g.setAttribute('position', position);
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('aBary', new Float32BufferAttribute(bary, 3));
  g.setAttribute('aEmissive', new Float32BufferAttribute(emi, 1));
  g.setAttribute('aTint', new Float32BufferAttribute(tint, 1));
  g.setIndex(index);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
