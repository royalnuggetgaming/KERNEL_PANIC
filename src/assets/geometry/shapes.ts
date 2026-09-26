/** Small Boot-time geometry helpers shared by the generators (transforms, thin prisms, spikes). */
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';

export const IDENTITY_Q = new Quaternion();

export function vec3(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

/** Translation * rotation (XYZ Euler radians) * scale. */
export function trs(
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): Matrix4 {
  return new Matrix4().compose(
    new Vector3(px, py, pz),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(sx, sy, sz),
  );
}

function pushTri(out: number[], a: Vector3, b: Vector3, c: Vector3): void {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

/**
 * Thin closed prism from one triangle (9 floats), extruded by `thickness` along the triangle normal
 * (centred). Both faces plus 3 side quads, outward winding.
 */
export function triangleGeometry(tri: readonly number[], thickness: number): BufferGeometry {
  const a = new Vector3(tri[0], tri[1], tri[2]);
  const b = new Vector3(tri[3], tri[4], tri[5]);
  const c = new Vector3(tri[6], tri[7], tri[8]);
  const n = new Vector3()
    .crossVectors(new Vector3().subVectors(b, a), new Vector3().subVectors(c, a))
    .normalize()
    .multiplyScalar(thickness / 2);
  const a0 = a.clone().sub(n);
  const b0 = b.clone().sub(n);
  const c0 = c.clone().sub(n);
  const a1 = a.clone().add(n);
  const b1 = b.clone().add(n);
  const c1 = c.clone().add(n);
  const out: number[] = [];
  pushTri(out, a1, b1, c1);
  pushTri(out, a0, c0, b0);
  const ring0 = [a0, b0, c0];
  const ring1 = [a1, b1, c1];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    pushTri(out, ring0[i]!, ring0[j]!, ring1[j]!);
    pushTri(out, ring0[i]!, ring1[j]!, ring1[i]!);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  return g;
}

/** Square-based pyramid spike from `base` along unit `dir`, base half-size `r`, length `len`. */
export function spikeGeometry(base: Vector3, dir: Vector3, r: number, len: number): BufferGeometry {
  const d = dir.clone().normalize();
  const helper = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(d, helper).normalize().multiplyScalar(r);
  const v = new Vector3().crossVectors(d, u).normalize().multiplyScalar(r);
  const tip = base.clone().addScaledVector(d, len);
  const q = [
    base.clone().add(u).add(v),
    base.clone().sub(u).add(v),
    base.clone().sub(u).sub(v),
    base.clone().add(u).sub(v),
  ];
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p0 = q[i]!;
    const p1 = q[(i + 1) % 4]!;
    // Orient outward: normal must point away from the spike axis.
    const nrm = new Vector3().crossVectors(new Vector3().subVectors(p1, p0), new Vector3().subVectors(tip, p0));
    const mid = new Vector3().addVectors(p0, p1).multiplyScalar(0.5).sub(base);
    if (nrm.dot(mid) >= 0) pushTri(out, p0, p1, tip);
    else pushTri(out, p1, p0, tip);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(out, 3));
  return g;
}
