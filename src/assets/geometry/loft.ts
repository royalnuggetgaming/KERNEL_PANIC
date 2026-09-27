/**
 * Loft helper: skins a list of closed cross-sections (each in a plane z = const) into a triangle list with
 * outward winding, optionally capping the ends (point nose or flat cap). Boot-time only.
 */
export interface LoftSection {
  readonly z: number;
  /** Closed polygon (x, y) pairs, symmetric sections read best; at least 3 points. */
  readonly points: readonly (readonly [number, number])[];
}

export interface LoftResult {
  /** Side skin triangles (9 floats each). */
  readonly skin: number[];
  /** Front cap (last section) triangles. */
  readonly front: number[];
  /** Rear cap (first section) triangles. */
  readonly rear: number[];
}

function pushOriented(
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  ref: readonly [number, number, number],
): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * nx + ny * ny + nz * nz < 1e-14) return;
  const cx = (a[0] + b[0] + c[0]) / 3 - ref[0];
  const cy = (a[1] + b[1] + c[1]) / 3 - ref[1];
  const cz = (a[2] + b[2] + c[2]) / 3 - ref[2];
  if (nx * cx + ny * cy + nz * cz >= 0) out.push(...a, ...b, ...c);
  else out.push(...a, ...c, ...b);
}

function centroid(s: LoftSection): [number, number, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of s.points) {
    x += px;
    y += py;
  }
  return [x / s.points.length, y / s.points.length, s.z];
}

/**
 * Skins consecutive sections (same point count). `noseZ`/`noseY`, when given, closes the front with a point;
 * otherwise the front is a flat fan cap. The rear is always a flat fan cap.
 */
export function loft(sections: readonly LoftSection[], nose?: { z: number; y: number }): LoftResult {
  if (sections.length < 2) throw new Error('loft: needs at least 2 sections');
  const count = sections[0]!.points.length;
  const skin: number[] = [];
  const front: number[] = [];
  const rear: number[] = [];
  for (let s = 0; s + 1 < sections.length; s++) {
    const s0 = sections[s]!;
    const s1 = sections[s + 1]!;
    if (s0.points.length !== count || s1.points.length !== count) {
      throw new Error('loft: sections must have the same point count');
    }
    const c0 = centroid(s0);
    const c1 = centroid(s1);
    const ref: [number, number, number] = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2];
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const a: [number, number, number] = [s0.points[i]![0], s0.points[i]![1], s0.z];
      const b: [number, number, number] = [s0.points[j]![0], s0.points[j]![1], s0.z];
      const c: [number, number, number] = [s1.points[j]![0], s1.points[j]![1], s1.z];
      const d: [number, number, number] = [s1.points[i]![0], s1.points[i]![1], s1.z];
      pushOriented(skin, a, b, c, ref);
      pushOriented(skin, a, c, d, ref);
    }
  }
  const first = sections[0]!;
  const last = sections[sections.length - 1]!;
  const cf = centroid(first);
  const cl = centroid(last);
  const behind: [number, number, number] = [cf[0], cf[1], cf[2] + 1];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    pushOriented(
      rear,
      cf,
      [first.points[i]![0], first.points[i]![1], first.z],
      [first.points[j]![0], first.points[j]![1], first.z],
      behind,
    );
  }
  const tip: [number, number, number] = nose === undefined ? cl : [cl[0], nose.y, nose.z];
  const inside: [number, number, number] = [cl[0], cl[1], cl[2] - 1];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    pushOriented(
      front,
      tip,
      [last.points[i]![0], last.points[i]![1], last.z],
      [last.points[j]![0], last.points[j]![1], last.z],
      inside,
    );
  }
  return { skin, front, rear };
}

/** Symmetric 7-point sled cross-section: flat belly, flared chine, narrower deck. */
export function sledSection(z: number, halfW: number, h: number, y0: number): LoftSection {
  return {
    z,
    points: [
      [0, y0],
      [halfW * 0.7, y0],
      [halfW, y0 + h * 0.38],
      [halfW * 0.55, y0 + h],
      [-halfW * 0.55, y0 + h],
      [-halfW, y0 + h * 0.38],
      [-halfW * 0.7, y0],
    ],
  };
}
