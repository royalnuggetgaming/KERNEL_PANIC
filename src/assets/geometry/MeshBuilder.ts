/**
 * MeshBuilder composes primitives, extrusions, lathes, tubes and custom BufferGeometry parts (with transforms,
 * vertex colours, emissive mask and barycentric attributes) into ONE merged non-indexed BufferGeometry carrying
 * position, normal, uv, color (linear), aBary (vec3) and aEmissive (float). Boot-time only (allocates freely).
 *
 * Barycentric edges: every triangle gets (1,0,0)/(0,1,0)/(0,0,1). Edges shared with a neighbour whose normal is
 * within `featureAngleDeg` are hidden by forcing that barycentric component to 1 on all three vertices, so
 * quads and pentagons glow only along their real outlines ('feature'); 'all' keeps every triangle edge and
 * 'none' hides them all.
 */
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix3,
  Matrix4,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
} from 'three';

export type EdgeMode = 'feature' | 'all' | 'none';

export interface PartOptions {
  /** sRGB hex albedo (converted to linear). Default 0x2a3140. */
  readonly color?: number;
  /** Emissive mask 0..1 for every vertex of the part. Default 0. */
  readonly emissive?: number;
  /** Per-vertex emissive override from the transformed position/normal. */
  readonly emissiveFn?: (p: Vector3, n: Vector3) => number;
  readonly matrix?: Matrix4;
  /** Recompute face normals (faceted look). Default true. */
  readonly flat?: boolean;
  readonly edges?: EdgeMode;
  /** Neighbouring faces closer than this angle hide their shared edge ('feature' mode). Default 1. */
  readonly featureAngleDeg?: number;
  /** Reverse winding and normals (inside-out, e.g. the sky sphere). */
  readonly invert?: boolean;
}

const DEFAULT_COLOR = 0x2a3140;

type AnyAttribute = BufferAttribute | InterleavedBufferAttribute;

function vertexKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
}

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uvs: number[] = [];
  private readonly col: number[] = [];
  private readonly bary: number[] = [];
  private readonly emi: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  /** Appends a part (the source geometry is read, then disposed). */
  add(source: BufferGeometry, opts: PartOptions = {}): this {
    const g = source.index !== null ? source.toNonIndexed() : source;
    const p = g.getAttribute('position') as AnyAttribute | undefined;
    if (p === undefined) throw new Error('MeshBuilder.add: geometry has no position attribute');
    const n = g.getAttribute('normal') as AnyAttribute | undefined;
    const uv = g.getAttribute('uv') as AnyAttribute | undefined;
    const m = opts.matrix ?? new Matrix4();
    const nm = new Matrix3().getNormalMatrix(m);
    const invert = opts.invert ?? false;
    const flip = m.determinant() < 0 !== invert;
    const flat = opts.flat ?? true;
    const color = new Color().setHex(opts.color ?? DEFAULT_COLOR);
    const emissive = opts.emissive ?? 0;
    const triCount = Math.floor(p.count / 3);
    const start = this.pos.length / 3;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const e1 = new Vector3();
    const e2 = new Vector3();
    const fn = new Vector3();
    const vn = new Vector3();
    const order = flip ? [0, 2, 1] : [0, 1, 2];
    for (let t = 0; t < triCount; t++) {
      a.fromBufferAttribute(p, t * 3 + order[0]!).applyMatrix4(m);
      b.fromBufferAttribute(p, t * 3 + order[1]!).applyMatrix4(m);
      c.fromBufferAttribute(p, t * 3 + order[2]!).applyMatrix4(m);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      fn.crossVectors(e1, e2);
      if (fn.lengthSq() < 1e-18) continue; // degenerate triangle
      fn.normalize();
      const corners = [a, b, c];
      for (let k = 0; k < 3; k++) {
        const src = t * 3 + order[k]!;
        const v = corners[k]!;
        this.pos.push(v.x, v.y, v.z);
        if (flat || n === undefined) vn.copy(fn);
        else {
          vn.fromBufferAttribute(n, src).applyMatrix3(nm);
          if (vn.lengthSq() < 1e-12) vn.copy(fn);
          else if (invert) vn.negate();
          vn.normalize();
        }
        this.nrm.push(vn.x, vn.y, vn.z);
        if (uv !== undefined) this.uvs.push(uv.getX(src), uv.getY(src));
        else this.uvs.push(0, 0);
        this.col.push(color.r, color.g, color.b);
        this.bary.push(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
        const e = opts.emissiveFn === undefined ? emissive : opts.emissiveFn(v, vn);
        this.emi.push(e < 0 ? 0 : e > 1 ? 1 : e);
      }
    }
    this.applyEdgeMode(start, opts.edges ?? 'feature', opts.featureAngleDeg ?? 1);
    if (g !== source) g.dispose();
    source.dispose();
    return this;
  }

  /** Adds the part and its mirror across the YZ plane (x -> -x), fixing the winding. */
  addMirroredX(source: BufferGeometry, opts: PartOptions = {}): this {
    const m = opts.matrix ?? new Matrix4();
    const mirrored = new Matrix4().makeScale(-1, 1, 1).multiply(m);
    const copy = source.clone();
    this.add(source, opts);
    return this.add(copy, { ...opts, matrix: mirrored });
  }

  /** Appends a raw triangle list (world positions, 9 floats per triangle). */
  addTriangles(positions: readonly number[], opts: PartOptions = {}): this {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return this.add(g, opts);
  }

  /** Merges the accumulated parts into one geometry. The builder can be reused afterwards (it is reset). */
  build(name: string): BufferGeometry {
    const g = new BufferGeometry();
    g.name = name;
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBary', new Float32BufferAttribute(this.bary, 3));
    g.setAttribute('aEmissive', new Float32BufferAttribute(this.emi, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    this.pos.length = 0;
    this.nrm.length = 0;
    this.uvs.length = 0;
    this.col.length = 0;
    this.bary.length = 0;
    this.emi.length = 0;
    return g;
  }

  private applyEdgeMode(startVertex: number, mode: EdgeMode, featureAngleDeg: number): void {
    const endVertex = this.pos.length / 3;
    if (mode === 'all') return;
    if (mode === 'none') {
      for (let v = startVertex; v < endVertex; v++) {
        this.bary[v * 3] = 1;
        this.bary[v * 3 + 1] = 1;
        this.bary[v * 3 + 2] = 1;
      }
      return;
    }
    const cosLimit = Math.cos((featureAngleDeg * Math.PI) / 180);
    // Edge opposite corner k of triangle t: corners (k+1)%3 and (k+2)%3.
    const edges = new Map<string, number[]>();
    const keys: string[] = [];
    for (let v = startVertex; v < endVertex; v++) {
      keys.push(vertexKey(this.pos[v * 3]!, this.pos[v * 3 + 1]!, this.pos[v * 3 + 2]!));
    }
    const triStart = startVertex / 3;
    const triEnd = endVertex / 3;
    for (let t = triStart; t < triEnd; t++) {
      for (let k = 0; k < 3; k++) {
        const ka = keys[(t - triStart) * 3 + ((k + 1) % 3)]!;
        const kb = keys[(t - triStart) * 3 + ((k + 2) % 3)]!;
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const list = edges.get(key);
        if (list === undefined) edges.set(key, [t * 3 + k]);
        else list.push(t * 3 + k);
      }
    }
    for (const list of edges.values()) {
      if (list.length !== 2) continue;
      const e0 = list[0]!;
      const e1 = list[1]!;
      const t0 = Math.floor(e0 / 3);
      const t1 = Math.floor(e1 / 3);
      const dot =
        this.nrmFace(t0, 0) * this.nrmFace(t1, 0) +
        this.nrmFace(t0, 1) * this.nrmFace(t1, 1) +
        this.nrmFace(t0, 2) * this.nrmFace(t1, 2);
      if (dot < cosLimit) continue;
      this.hideEdge(t0, e0 % 3);
      this.hideEdge(t1, e1 % 3);
    }
  }

  /** Face normal component from the triangle's positions (independent of smooth vertex normals). */
  private nrmFace(t: number, axis: 0 | 1 | 2): number {
    const o = t * 9;
    const p = this.pos;
    const ux = p[o + 3]! - p[o]!;
    const uy = p[o + 4]! - p[o + 1]!;
    const uz = p[o + 5]! - p[o + 2]!;
    const vx = p[o + 6]! - p[o]!;
    const vy = p[o + 7]! - p[o + 1]!;
    const vz = p[o + 8]! - p[o + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return (axis === 0 ? nx : axis === 1 ? ny : nz) / len;
  }

  private hideEdge(t: number, k: number): void {
    for (let v = 0; v < 3; v++) this.bary[(t * 3 + v) * 3 + k] = 1;
  }
}
