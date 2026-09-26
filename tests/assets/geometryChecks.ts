/** Shared structural checks for generated BufferGeometry (node, no WebGL). */
import { Box3, Vector3, type BufferAttribute, type BufferGeometry } from 'three';
import { expect } from 'vitest';

export const REQUIRED_ATTRIBUTES = ['position', 'normal', 'color', 'aBary', 'aEmissive'] as const;

const ITEM_SIZE: Readonly<Record<string, number>> = {
  position: 3,
  normal: 3,
  color: 3,
  aBary: 3,
  aEmissive: 1,
  uv: 2,
};

function attr(g: BufferGeometry, name: string): BufferAttribute {
  const a = g.getAttribute(name) as BufferAttribute | undefined;
  if (a === undefined) throw new Error(`${g.name}: missing attribute ${name}`);
  return a;
}

/** Attribute presence, counts, finiteness, unit normals, barycentric validity, [0,1] colour/emissive. */
export function checkGeometry(g: BufferGeometry, opts: { indexed?: boolean } = {}): void {
  const pos = attr(g, 'position');
  const count = pos.count;
  expect(count, `${g.name} vertex count`).toBeGreaterThan(0);
  for (const name of [...REQUIRED_ATTRIBUTES, 'uv']) {
    const a = attr(g, name);
    expect(a.count, `${g.name}.${name} count`).toBe(count);
    expect(a.itemSize, `${g.name}.${name} itemSize`).toBe(ITEM_SIZE[name]);
  }
  if (opts.indexed === true) {
    expect(g.index).not.toBeNull();
    const idx = g.index!;
    expect(idx.count % 3).toBe(0);
    for (let i = 0; i < idx.count; i++) expect(idx.getX(i)).toBeLessThan(count);
  } else {
    expect(g.index, `${g.name} must be non-indexed`).toBeNull();
    expect(count % 3, `${g.name} triangle list`).toBe(0);
  }
  const nrm = attr(g, 'normal');
  const col = attr(g, 'color');
  const emi = attr(g, 'aEmissive');
  const uv = attr(g, 'uv');
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`${g.name}: non-finite position at ${String(i)}`);
    }
    const len = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    if (Math.abs(len - 1) > 1e-3) throw new Error(`${g.name}: normal ${String(i)} has length ${String(len)}`);
    for (let c = 0; c < 3; c++) {
      const v = col.getComponent(i, c);
      if (!(v >= 0 && v <= 1)) throw new Error(`${g.name}: colour out of range at ${String(i)}`);
    }
    const e = emi.getX(i);
    if (!(e >= 0 && e <= 1)) throw new Error(`${g.name}: emissive out of range at ${String(i)}`);
    if (!Number.isFinite(uv.getX(i)) || !Number.isFinite(uv.getY(i))) {
      throw new Error(`${g.name}: non-finite uv at ${String(i)}`);
    }
  }
  if (opts.indexed !== true) checkBarycentrics(g);
}

/**
 * Each triangle's aBary component k is either one-hot at corner k (a visible edge opposite corner k) or 1 on
 * all three corners (a hidden edge).
 */
export function checkBarycentrics(g: BufferGeometry): void {
  const b = attr(g, 'aBary');
  const tris = b.count / 3;
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const v0 = b.getComponent(t * 3, k);
      const v1 = b.getComponent(t * 3 + 1, k);
      const v2 = b.getComponent(t * 3 + 2, k);
      const hidden = v0 === 1 && v1 === 1 && v2 === 1;
      const oneHot = [v0, v1, v2].every((v, i) => v === (i === k ? 1 : 0));
      if (!hidden && !oneHot) {
        throw new Error(`${g.name}: bad barycentrics on triangle ${String(t)} component ${String(k)}`);
      }
    }
  }
}

export function boundsOf(g: BufferGeometry): Box3 {
  return new Box3().setFromBufferAttribute(attr(g, 'position'));
}

/** Max distance of any vertex from `c`. */
export function maxDistanceFrom(g: BufferGeometry, c: Vector3): number {
  const pos = attr(g, 'position');
  const v = new Vector3();
  let best = 0;
  for (let i = 0; i < pos.count; i++) best = Math.max(best, v.fromBufferAttribute(pos, i).distanceTo(c));
  return best;
}

/** Fraction of triangle area whose normal points away from `c` (winding sanity for convex-ish solids). */
export function outwardFraction(g: BufferGeometry, c: Vector3): number {
  const pos = attr(g, 'position');
  const a = new Vector3();
  const b = new Vector3();
  const d = new Vector3();
  const n = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  let out = 0;
  let total = 0;
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    d.fromBufferAttribute(pos, t * 3 + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a));
    const area = n.length() / 2;
    const centroid = a
      .add(b)
      .add(d)
      .multiplyScalar(1 / 3)
      .sub(c);
    total += area;
    if (n.dot(centroid) > 0) out += area;
  }
  return total > 0 ? out / total : 0;
}

/** Fraction of edges (triangle components) left visible by the barycentric edge mask. */
export function visibleEdgeFraction(g: BufferGeometry): number {
  const b = attr(g, 'aBary');
  let visible = 0;
  const tris = b.count / 3;
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) if (b.getComponent(t * 3 + ((k + 1) % 3), k) === 0) visible++;
  }
  return tris > 0 ? visible / (tris * 3) : 0;
}
